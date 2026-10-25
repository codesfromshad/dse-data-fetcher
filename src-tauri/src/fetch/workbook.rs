//! The output workbook (was ExcelJS in the webview).

use rust_xlsxwriter::{Format, Workbook, XlsxError};

use super::parse::CompanyRow;

pub struct Column {
    pub header: &'static str,
    pub width: f64,
}

/// `key` is the field the column shows (documentation; `cells` follows this order).
const fn col(header: &'static str, _key: &'static str, width: f64) -> Column {
    Column { header, width }
}

pub const COLUMNS: [Column; 14] = [
    col("Scrip Code", "scrip_code", 10.0),
    col("Symbol", "symbol", 10.0),
    col("Company Name", "company_name", 50.0),
    col("Sector", "sector", 30.0),
    col("Last Updated Timestamp", "last_updated_timestamp", 30.0),
    col("Yesterday's Closing Price", "yesterdays_closing_price", 20.0),
    col("Total No. of Outstanding Securities", "total_no_of_outstanding_securities", 30.0),
    col("Market Capitalization", "market_capitalization", 30.0),
    col("As Of Date", "share_percentage_as_of_date", 20.0),
    col("Sponsor/Director", "share_percentage_sponsor_director", 10.0),
    col("Government", "share_percentage_government", 10.0),
    col("Institute", "share_percentage_institute", 10.0),
    col("Foreign", "share_percentage_foreign", 10.0),
    col("Public", "share_percentage_public", 10.0),
];

pub enum Cell<'a> {
    Text(&'a str),
    Number(f64),
    Blank,
}

/// The row's cells in `COLUMNS` order.
pub fn cells(row: &CompanyRow) -> [Cell<'_>; 14] {
    let num = |v: Option<f64>| v.map_or(Cell::Blank, Cell::Number);
    [
        Cell::Number(row.scrip_code as f64),
        Cell::Text(&row.symbol),
        Cell::Text(&row.company_name),
        Cell::Text(&row.sector),
        Cell::Text(&row.last_updated_timestamp),
        num(row.yesterdays_closing_price),
        num(row.total_no_of_outstanding_securities),
        num(row.market_capitalization),
        Cell::Text(&row.share_percentage_as_of_date),
        Cell::Number(row.share_percentage_sponsor_director),
        Cell::Number(row.share_percentage_government),
        Cell::Number(row.share_percentage_institute),
        Cell::Number(row.share_percentage_foreign),
        Cell::Number(row.share_percentage_public),
    ]
}

/// Header labels of the columns that came back NaN or empty. DSE sometimes
/// serves a page with blanks where the numbers should be.
pub fn incomplete_fields(row: &CompanyRow) -> Vec<&'static str> {
    COLUMNS
        .iter()
        .zip(cells(row))
        .filter(|(_, cell)| match cell {
            Cell::Blank => true,
            Cell::Text(text) => text.is_empty(),
            Cell::Number(n) => !n.is_finite(),
        })
        .map(|(column, _)| column.header)
        .collect()
}

/// One `stock_data` sheet: bold, frozen header row, then one row per company.
pub fn build(rows: &[CompanyRow]) -> Result<Vec<u8>, XlsxError> {
    let mut workbook = Workbook::new();
    let sheet = workbook.add_worksheet();
    sheet.set_name("stock_data")?;
    let bold = Format::new().set_bold();

    for (c, column) in COLUMNS.iter().enumerate() {
        let c = c as u16;
        sheet.set_column_width(c, column.width)?;
        sheet.write_string_with_format(0, c, column.header, &bold)?;
    }
    sheet.set_freeze_panes(1, 0)?;

    for (r, row) in rows.iter().enumerate() {
        let r = r as u32 + 1;
        for (c, cell) in cells(row).into_iter().enumerate() {
            let c = c as u16;
            match cell {
                Cell::Text(text) => {
                    sheet.write_string(r, c, text)?;
                }
                Cell::Number(n) if n.is_finite() => {
                    sheet.write_number(r, c, n)?;
                }
                // NaN would show up as an error in Excel; leave it blank.
                _ => {}
            }
        }
    }
    workbook.save_to_buffer()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(symbol: &str) -> CompanyRow {
        CompanyRow {
            symbol: symbol.into(),
            scrip_code: 1,
            company_name: "Co".into(),
            sector: "Bank".into(),
            last_updated_timestamp: "2026-10-22T14:30:00+06:00".into(),
            yesterdays_closing_price: Some(1.0),
            total_no_of_outstanding_securities: Some(2.0),
            market_capitalization: Some(3.0),
            share_percentage_as_of_date: "2026-09-30".into(),
            share_percentage_sponsor_director: 1.0,
            share_percentage_government: 0.0,
            share_percentage_institute: 1.0,
            share_percentage_foreign: 1.0,
            share_percentage_public: 97.0,
        }
    }

    #[test]
    fn incomplete_fields_lists_headers() {
        let mut row = sample("A");
        assert!(incomplete_fields(&row).is_empty());
        row.yesterdays_closing_price = None;
        row.share_percentage_as_of_date.clear();
        assert_eq!(incomplete_fields(&row), ["Yesterday's Closing Price", "As Of Date"]);
    }

    #[test]
    fn builds_an_xlsx() {
        let mut blank = sample("B");
        blank.market_capitalization = None;
        let bytes = build(&[sample("A"), blank]).unwrap();
        assert_eq!(&bytes[..2], b"PK");
    }
}
