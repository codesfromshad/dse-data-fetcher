//! Finding the app that opens .xlsx files, and launching a user-chosen one.

use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub path: String,
    /// Friendly name, e.g. "Excel" or "LibreOffice Calc".
    pub name: String,
}

/// The system's default app for .xlsx, or `None` if nothing is associated.
#[cfg(windows)]
pub fn system_default() -> Option<AppInfo> {
    let path = win::assoc_query(win::ASSOCF_NONE, win::ASSOCSTR_EXECUTABLE, ".xlsx")?;
    // With no real association Windows can hand back the "How do you want to
    // open this file?" picker instead of an app.
    let file_name = Path::new(&path).file_name()?.to_string_lossy().to_ascii_lowercase();
    if file_name == "openwith.exe" || file_name == "rundll32.exe" || !Path::new(&path).is_file() {
        return None;
    }
    let name = win::assoc_query(win::ASSOCF_NONE, win::ASSOCSTR_FRIENDLYAPPNAME, ".xlsx")
        .unwrap_or_else(|| file_stem(&path));
    Some(AppInfo { path, name })
}

/// Not checkable outside Windows; report nothing and let the OS decide.
#[cfg(not(windows))]
pub fn system_default() -> Option<AppInfo> {
    None
}

/// Describe a user-chosen .exe. `None` if it doesn't exist (moved/uninstalled).
pub fn describe(path: &Path) -> Option<AppInfo> {
    if !path.is_file() {
        return None;
    }
    let path_str = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    let name = win::assoc_query(win::ASSOCF_INIT_BYEXENAME, win::ASSOCSTR_FRIENDLYAPPNAME, &path_str);
    #[cfg(not(windows))]
    let name: Option<String> = None;
    Some(AppInfo { name: name.unwrap_or_else(|| file_stem(&path_str)), path: path_str })
}

/// Check that a picked file can plausibly be launched.
pub fn validate(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err(format!("{} doesn't exist.", path.display()));
    }
    #[cfg(windows)]
    {
        let is_exe = path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
        if !is_exe {
            return Err("Pick the program's .exe file (for example EXCEL.EXE).".into());
        }
    }
    Ok(())
}

/// Open `file` with the given program, without waiting for it.
pub fn launch(program: &Path, file: &Path) -> Result<(), String> {
    std::process::Command::new(program)
        .arg(file)
        .spawn()
        .map(drop)
        .map_err(|e| format!("Couldn't start {}: {e}", program.display()))
}

fn file_stem(path: &str) -> String {
    Path::new(path).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string())
}

#[cfg(windows)]
mod win {
    pub use windows_sys::Win32::UI::Shell::{
        ASSOCF_INIT_BYEXENAME, ASSOCF_NONE, ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME,
    };
    use windows_sys::Win32::UI::Shell::{AssocQueryStringW, ASSOCF, ASSOCSTR};

    /// Wrapper over AssocQueryStringW. `None` on any failure (e.g. no association).
    pub fn assoc_query(flags: ASSOCF, what: ASSOCSTR, assoc: &str) -> Option<String> {
        let assoc: Vec<u16> = assoc.encode_utf16().chain(std::iter::once(0)).collect();
        let mut buffer = vec![0u16; 1024];
        let mut len = buffer.len() as u32;
        // SAFETY: `assoc` is NUL-terminated, `buffer` holds `len` u16s and the
        // API writes at most that many (including the terminator).
        let hr = unsafe {
            AssocQueryStringW(flags, what, assoc.as_ptr(), std::ptr::null(), buffer.as_mut_ptr(), &mut len)
        };
        if hr != 0 || len == 0 {
            return None;
        }
        let end = buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len());
        let value = String::from_utf16_lossy(&buffer[..end]).trim().to_string();
        (!value.is_empty()).then_some(value)
    }
}
