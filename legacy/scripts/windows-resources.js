import * as PELibrary from 'pe-library';
import * as ResEdit from 'resedit';

/**
 * Replace the icon and version info inside the compiled .exe.
 *
 * Bun's own --windows-icon / --windows-* options only take effect when the
 * build runs ON Windows; cross-compiling from Linux/macOS silently keeps Bun's
 * icon and "Bun / Oven" details. So we patch the PE resources ourselves, which
 * works from any OS.
 *
 * Bun stores the app's JS in a `.bun` section placed AFTER `.rsrc`, so the
 * resource section can't be moved or grown (resedit's normal path refuses to
 * try). Instead the new resource data is written into the existing `.rsrc`
 * slot in place: no other section moves, and the payload is untouched.
 */
export async function stampWindowsResources(file, meta) {
  const bytes = new Uint8Array(await Bun.file(file).arrayBuffer());
  const exe = PELibrary.NtExecutable.from(bytes.buffer, { ignoreCert: true });
  const res = readResourcesInPlace(exe);

  // Icon: swap the icons in Bun's existing icon group (keeps its ID/language,
  // which is what Explorer looks up).
  const iconFile = ResEdit.Data.IconFile.from(await Bun.file(meta.icon).arrayBuffer());
  const group = ResEdit.Resource.IconGroupEntry.fromEntries(res.entries)[0];
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    group?.id ?? 1,
    group?.lang ?? 1033,
    iconFile.icons.map((icon) => icon.data),
  );

  // Version info: start fresh rather than editing Bun's, so no stale strings survive.
  for (let i = res.entries.length - 1; i >= 0; i--) {
    if (res.entries[i].type === 16 /* RT_VERSION */) res.entries.splice(i, 1);
  }
  const lang = 1033; // en-US
  const vi = ResEdit.Resource.VersionInfo.createEmpty();
  vi.lang = lang;
  vi.setFileVersion(...meta.version, lang);
  vi.setProductVersion(...meta.version, lang);
  vi.setStringValues(
    { lang, codepage: 1200 },
    {
      FileDescription: meta.description,
      ProductName: meta.productName,
      CompanyName: meta.company,
      LegalCopyright: meta.copyright,
      FileVersion: meta.version.join('.'),
      ProductVersion: meta.productVersion,
      InternalName: 'dse-data-fetcher',
      OriginalFilename: 'dse-data-fetcher.exe',
    },
  );
  vi.outputToResourceEntries(res.entries);

  // --- Write the new .rsrc in place ---------------------------------------
  const view = new DataView(bytes.buffer);
  const peOffset = view.getUint32(0x3c, true);
  const sectionCount = view.getUint16(peOffset + 6, true);
  const optOffset = peOffset + 24;
  if (view.getUint16(optOffset, true) !== 0x20b) throw new Error('Expected a PE32+ (64-bit) executable');
  const fileAlignment = view.getUint32(optOffset + 36, true);
  const resourceDirOffset = optOffset + 112 + 2 * 8; // data directory #2 = resources
  const sectionTable = optOffset + view.getUint16(peOffset + 20, true);

  let rsrc;
  for (let i = 0; i < sectionCount; i++) {
    const at = sectionTable + i * 40;
    const name = new TextDecoder().decode(bytes.subarray(at, at + 8)).replace(/\0+$/, '');
    if (name === '.rsrc') {
      rsrc = {
        at,
        virtualSize: view.getUint32(at + 8, true),
        virtualAddress: view.getUint32(at + 12, true),
        rawSize: view.getUint32(at + 16, true),
        rawPointer: view.getUint32(at + 20, true),
      };
    }
  }
  if (!rsrc) throw new Error('No .rsrc section found in the compiled exe');

  const generated = res.generateResourceData(rsrc.virtualAddress, fileAlignment);
  const data = new Uint8Array(generated.bin, 0, generated.rawSize);
  // Bytes past VirtualSize aren't mapped into memory, so that's the real limit.
  const capacity = Math.min(rsrc.rawSize, rsrc.virtualSize);
  if (data.byteLength > capacity) {
    throw new Error(
      `New resources (${data.byteLength} B) don't fit Bun's .rsrc slot (${capacity} B). Use a smaller icon.`,
    );
  }

  bytes.fill(0, rsrc.rawPointer, rsrc.rawPointer + rsrc.rawSize);
  bytes.set(data, rsrc.rawPointer);
  // Leave the section's VirtualSize alone: Windows refuses to load an image
  // with gaps between sections ("This app can't run on your PC"). The data
  // directory below is what tells Windows how big the resource data is.
  view.setUint32(resourceDirOffset, rsrc.virtualAddress, true);
  view.setUint32(resourceDirOffset + 4, data.byteLength, true);
  writePeChecksum(bytes, optOffset + 64);

  assertLoadableLayout(view, { sectionTable, sectionCount, optOffset, resourceDirOffset });
  await Bun.write(file, bytes);
}

/**
 * Sanity checks Windows' loader also makes, so a bad patch fails the build
 * instead of producing an exe that won't start.
 */
function assertLoadableLayout(view, { sectionTable, sectionCount, optOffset, resourceDirOffset }) {
  const sectionAlignment = view.getUint32(optOffset + 32, true);
  const sizeOfImage = view.getUint32(optOffset + 56, true);
  const align = (n) => Math.ceil(n / sectionAlignment) * sectionAlignment;

  const sections = Array.from({ length: sectionCount }, (_, i) => {
    const at = sectionTable + i * 40;
    return { va: view.getUint32(at + 12, true), vsize: view.getUint32(at + 8, true) };
  });
  for (let i = 1; i < sections.length; i++) {
    const prev = sections[i - 1];
    if (align(prev.va + prev.vsize) !== sections[i].va) {
      throw new Error(`Patched exe would have a gap between sections ${i - 1} and ${i}; refusing to write it`);
    }
  }
  const last = sections.at(-1);
  if (align(last.va + last.vsize) !== sizeOfImage) throw new Error('Patched exe has an inconsistent SizeOfImage');

  const resVa = view.getUint32(resourceDirOffset, true);
  const resSize = view.getUint32(resourceDirOffset + 4, true);
  const home = sections.find((s) => resVa >= s.va && resVa < s.va + s.vsize);
  if (!home || resVa + resSize > home.va + home.vsize) throw new Error('Resource directory points outside its section');
}

/**
 * Same as NtExecutableResource.from(), minus its section-order check. That
 * check exists because pe-library normally rewrites .rsrc by moving it, which
 * we never do (see stampWindowsResources).
 */
function readResourcesInPlace(exe) {
  const RESOURCE_DIRECTORY = 2;
  const section = exe.getSectionByEntry(RESOURCE_DIRECTORY);
  if (!section) throw new Error('No resource section found in the compiled exe');
  const res = new PELibrary.NtExecutableResource();
  res.sectionDataHeader = { ...section.info };
  res.parse(section, false);
  return res;
}

/** Standard PE image checksum (what Windows' CheckSumMappedFile computes). */
function writePeChecksum(bytes, checksumOffset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(checksumOffset, 0, true);
  let sum = 0;
  const end = bytes.byteLength & ~1;
  for (let i = 0; i < end; i += 2) {
    sum += view.getUint16(i, true);
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  if (bytes.byteLength & 1) {
    sum += bytes[bytes.byteLength - 1];
    sum = (sum & 0xffff) + (sum >>> 16);
  }
  sum = (sum & 0xffff) + (sum >>> 16);
  view.setUint32(checksumOffset, (sum + bytes.byteLength) >>> 0, true);
}
