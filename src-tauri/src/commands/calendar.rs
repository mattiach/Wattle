use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::state::AppState;

/// One day that holds writing, and how much of it.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DayCountDto {
    pub date: String,
    /// Everything written that day, of either kind.
    pub count: i64,
    /// How many of them were sparks.
    pub sparks: i64,
}

/// The entries either side of one, in the order the journal reads.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AdjacentEntriesDto {
    /// The entry just before this one in time, if there is one.
    pub previous: Option<i64>,
    pub next: Option<i64>,
}

/// Something written on this day in an earlier year.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemoryDto {
    pub id: i64,
    pub title: String,
    pub preview: String,
    pub entry_date: String,
    pub years_ago: i64,
    /// The entry's first image, if it has one, for the card to show.
    pub image_path: Option<String>,
}

/// A spark from far enough back to have stopped being recent.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SparkEchoDto {
    pub id: i64,
    pub preview: String,
    pub entry_date: String,
    /// Whole days between the spark's day and today, for a relative age.
    pub days_ago: i64,
}

/// How old a spark has to be before it may come back.
const ECHO_COOLDOWN_DAYS: i64 = 30;

/// Which candidate today's echo is, given the day and how many there are.
fn rotation_index(day_number: i64, count: i64) -> i64 {
    if count <= 0 {
        return 0;
    }
    day_number.rem_euclid(count)
}

/// Days since 1970-01-01 for a `YYYY-MM-DD` date.
pub(crate) fn days_from_civil(date: &str) -> Option<i64> {
    let year: i64 = date.get(0..4)?.parse().ok()?;
    let month: i64 = date.get(5..7)?.parse().ok()?;
    let day: i64 = date.get(8..10)?.parse().ok()?;

    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let shifted_month = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some(era * 146_097 + day_of_era - 719_468)
}

/// The one older spark that comes back today, if there is one.
fn spark_echo_impl(conn: &Connection, today: &str) -> Result<Option<SparkEchoDto>, String> {
    if !crate::commands::entries::is_calendar_date(today) {
        return Err(format!("invalid date: {today:?}"));
    }
    let cutoff = format!("-{ECHO_COOLDOWN_DAYS} days");

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM entries \
             WHERE kind = 'spark' AND preview <> '' AND entry_date <= date(?1, ?2)",
            params![today, cutoff],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count == 0 {
        return Ok(None);
    }

    let day_number = days_from_civil(today).ok_or_else(|| "unreadable date".to_string())?;
    let offset = rotation_index(day_number, count);

    let picked = conn
        .query_row(
            "SELECT id, preview, entry_date FROM entries \
             WHERE kind = 'spark' AND preview <> '' AND entry_date <= date(?1, ?2) \
             ORDER BY entry_date, id LIMIT 1 OFFSET ?3",
            params![today, cutoff, offset],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some((id, preview, entry_date)) = picked else {
        return Ok(None);
    };
    let days_ago = day_number - days_from_civil(&entry_date).unwrap_or(day_number);

    Ok(Some(SparkEchoDto {
        id,
        preview,
        entry_date,
        days_ago,
    }))
}

/// How far from the anniversary a memory may be found.
const MEMORY_WINDOW_DAYS: i64 = 3;

fn year_of(entry_date: &str) -> Result<i64, String> {
    entry_date
        .get(0..4)
        .and_then(|y| y.parse().ok())
        .ok_or_else(|| "unreadable entry year".to_string())
}

/// What was written on this day in previous years.
fn on_this_day_impl(conn: &Connection, today: &str) -> Result<Vec<MemoryDto>, String> {
    if !crate::commands::entries::is_calendar_date(today) {
        return Err(format!("invalid date: {today:?}"));
    }
    let current_year = year_of(today)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, title, preview, entry_date, offset FROM ( \
               SELECT id, title, preview, entry_date, CAST( \
                 julianday(entry_date) - julianday(date(?1, \
                   (CAST(substr(entry_date, 1, 4) AS INTEGER) - ?2) || ' years')) \
                 AS INTEGER) AS offset \
               FROM entries WHERE CAST(substr(entry_date, 1, 4) AS INTEGER) < ?2) \
             WHERE abs(offset) <= ?3 ORDER BY entry_date DESC, id DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![today, current_year, MEMORY_WINDOW_DAYS], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut closest: HashMap<i64, i64> = HashMap::new();
    for (_, _, _, entry_date, offset) in &rows {
        let best = closest.entry(year_of(entry_date)?).or_insert(*offset);
        if (offset.abs(), *offset) < (best.abs(), *best) {
            *best = *offset;
        }
    }

    let mut memories = Vec::with_capacity(closest.len());

    for (id, title, preview, entry_date, offset) in rows {
        let entry_year = year_of(&entry_date)?;
        if closest.get(&entry_year) != Some(&offset) {
            continue;
        }
        let image_path = conn
            .query_row(
                "SELECT path FROM attachments \
                 WHERE entry_id = ?1 AND mime_type LIKE 'image/%' \
                 ORDER BY created_at, id LIMIT 1",
                params![id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        memories.push(MemoryDto {
            id,
            title,
            preview,
            entry_date,
            years_ago: current_year - entry_year,
            image_path,
        });
    }

    Ok(memories)
}

/// Which days in a range were written on.
fn entry_dates_in_range_impl(
    conn: &Connection,
    from: &str,
    to: &str,
) -> Result<Vec<DayCountDto>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT entry_date, COUNT(*), COALESCE(SUM(kind = 'spark'), 0) FROM entries \
             WHERE entry_date >= ?1 AND entry_date <= ?2 \
             GROUP BY entry_date ORDER BY entry_date",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![from, to], |row| {
            Ok(DayCountDto {
                date: row.get(0)?,
                count: row.get(1)?,
                sparks: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

/// Moving through the journal one entry at a time.
fn adjacent_entries_impl(conn: &Connection, id: i64) -> Result<AdjacentEntriesDto, String> {
    let entry_date: Option<String> = conn
        .query_row(
            "SELECT entry_date FROM entries WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let Some(entry_date) = entry_date else {
        return Ok(AdjacentEntriesDto {
            previous: None,
            next: None,
        });
    };

    let previous = conn
        .query_row(
            "SELECT id FROM entries WHERE (entry_date, id) < (?1, ?2) \
             ORDER BY entry_date DESC, id DESC LIMIT 1",
            params![entry_date, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    let next = conn
        .query_row(
            "SELECT id FROM entries WHERE (entry_date, id) > (?1, ?2) \
             ORDER BY entry_date ASC, id ASC LIMIT 1",
            params![entry_date, id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(AdjacentEntriesDto { previous, next })
}

/// Lets a neighbouring module assert that the calendar counts sparks too,
/// without exposing the query itself.
#[cfg(test)]
pub fn entry_dates_in_range_for_test(
    conn: &Connection,
    from: &str,
    to: &str,
) -> Result<Vec<DayCountDto>, String> {
    entry_dates_in_range_impl(conn, from, to)
}

#[tauri::command]
pub fn entry_dates_in_range(
    state: State<AppState>,
    from: String,
    to: String,
) -> Result<Vec<DayCountDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    entry_dates_in_range_impl(&conn, &from, &to)
}

#[tauri::command]
pub fn on_this_day(state: State<AppState>, today: String) -> Result<Vec<MemoryDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    on_this_day_impl(&conn, &today)
}

#[tauri::command]
pub fn spark_echo(state: State<AppState>, today: String) -> Result<Option<SparkEchoDto>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    spark_echo_impl(&conn, &today)
}

#[tauri::command]
pub fn adjacent_entries(state: State<AppState>, id: i64) -> Result<AdjacentEntriesDto, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    adjacent_entries_impl(&conn, id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_entry(conn: &Connection, date: &str) -> i64 {
        conn.execute(
            "INSERT INTO entries (entry_date) VALUES (?1)",
            params![date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn dates(counts: &[DayCountDto]) -> Vec<(&str, i64)> {
        counts
            .iter()
            .map(|day| (day.date.as_str(), day.count))
            .collect()
    }

    #[test]
    fn a_day_written_on_more_than_once_is_counted_not_repeated() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2026-08-16");
        write_entry(&conn, "2026-08-16");
        write_entry(&conn, "2026-08-16");
        write_entry(&conn, "2026-08-14");

        let counts = entry_dates_in_range_impl(&conn, "2026-08-01", "2026-08-31").unwrap();

        assert_eq!(dates(&counts), vec![("2026-08-14", 1), ("2026-08-16", 3)]);
    }

    #[test]
    fn a_range_with_nothing_in_it_comes_back_empty() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2026-08-16");

        let counts = entry_dates_in_range_impl(&conn, "2025-01-01", "2025-12-31").unwrap();
        assert!(counts.is_empty());

        let empty = crate::db::init_db_at_connection_for_test();
        assert!(
            entry_dates_in_range_impl(&empty, "2026-01-01", "2026-12-31")
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn the_range_includes_both_of_its_ends() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2026-07-31");
        write_entry(&conn, "2026-08-01");
        write_entry(&conn, "2026-08-31");
        write_entry(&conn, "2026-09-01");

        let august = entry_dates_in_range_impl(&conn, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(dates(&august), vec![("2026-08-01", 1), ("2026-08-31", 1)]);
    }

    #[test]
    fn a_year_boundary_does_not_leak_into_the_next() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2025-12-31");
        write_entry(&conn, "2026-01-01");
        write_entry(&conn, "2026-12-31");
        write_entry(&conn, "2027-01-01");

        let year = entry_dates_in_range_impl(&conn, "2026-01-01", "2026-12-31").unwrap();
        assert_eq!(dates(&year), vec![("2026-01-01", 1), ("2026-12-31", 1)]);
    }

    #[test]
    fn a_leap_day_is_an_ordinary_day() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2028-02-29");

        let february = entry_dates_in_range_impl(&conn, "2028-02-01", "2028-02-29").unwrap();
        assert_eq!(dates(&february), vec![("2028-02-29", 1)]);
    }

    fn titled_entry(conn: &Connection, title: &str, date: &str) -> i64 {
        conn.execute(
            "INSERT INTO entries (title, preview, entry_date) VALUES (?1, 'an excerpt', ?2)",
            params![title, date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn every_earlier_year_that_shares_the_day_comes_back_newest_first() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Last year", "2025-08-16");
        titled_entry(&conn, "Three years ago", "2023-08-16");
        titled_entry(&conn, "Two years ago", "2024-08-16");

        let memories = on_this_day_impl(&conn, "2026-08-16").unwrap();

        assert_eq!(
            memories
                .iter()
                .map(|m| (m.title.as_str(), m.years_ago))
                .collect::<Vec<_>>(),
            vec![
                ("Last year", 1),
                ("Two years ago", 2),
                ("Three years ago", 3)
            ]
        );
        assert_eq!(memories[0].preview, "an excerpt");
    }

    #[test]
    fn this_years_own_entries_are_not_memories() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Today", "2026-08-16");
        titled_entry(&conn, "Earlier today", "2026-08-16");
        titled_entry(&conn, "A year ago", "2025-08-16");

        let memories = on_this_day_impl(&conn, "2026-08-16").unwrap();

        assert_eq!(
            memories
                .iter()
                .map(|m| m.title.as_str())
                .collect::<Vec<_>>(),
            vec!["A year ago"]
        );
    }

    #[test]
    fn a_day_with_no_history_returns_nothing_rather_than_failing() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Some other day", "2025-03-04");

        assert!(on_this_day_impl(&conn, "2026-08-16").unwrap().is_empty());
        let empty = crate::db::init_db_at_connection_for_test();
        assert!(on_this_day_impl(&empty, "2026-08-16").unwrap().is_empty());
    }

    fn titles(memories: &[MemoryDto]) -> Vec<&str> {
        memories.iter().map(|m| m.title.as_str()).collect()
    }

    #[test]
    fn the_day_itself_beats_the_days_beside_it() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Day before", "2025-09-02");
        titled_entry(&conn, "The day", "2025-09-03");
        titled_entry(&conn, "Also the day", "2025-09-03");
        titled_entry(&conn, "Day after", "2025-09-04");

        let memories = on_this_day_impl(&conn, "2026-09-03").unwrap();
        assert_eq!(titles(&memories), vec!["Also the day", "The day"]);
    }

    #[test]
    fn a_nearby_day_stands_in_when_the_day_itself_holds_nothing() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Day before", "2025-09-02");
        titled_entry(&conn, "Day after", "2025-09-04");

        let memories = on_this_day_impl(&conn, "2026-09-03").unwrap();
        assert_eq!(titles(&memories), vec!["Day before"]);
        assert_eq!(memories[0].years_ago, 1);
    }

    #[test]
    fn each_year_offers_its_own_nearest_day() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Last year, two days out", "2025-09-05");
        titled_entry(&conn, "Two years ago, a day out", "2024-09-02");
        titled_entry(&conn, "Two years ago, on the day", "2024-09-03");

        let memories = on_this_day_impl(&conn, "2026-09-03").unwrap();
        assert_eq!(
            titles(&memories),
            vec!["Last year, two days out", "Two years ago, on the day"]
        );
    }

    #[test]
    fn a_day_further_out_than_the_window_is_not_this_time_of_year() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Four days before", "2025-08-30");
        titled_entry(&conn, "Same day, other month", "2025-08-03");

        assert!(on_this_day_impl(&conn, "2026-09-03").unwrap().is_empty());

        titled_entry(&conn, "Three days before", "2025-08-31");
        let memories = on_this_day_impl(&conn, "2026-09-03").unwrap();
        assert_eq!(titles(&memories), vec!["Three days before"]);
    }

    #[test]
    fn a_leap_day_finds_the_years_that_have_no_29th() {
        let conn = crate::db::init_db_at_connection_for_test();
        titled_entry(&conn, "Leap 2024", "2024-02-29");
        titled_entry(&conn, "Ordinary 2027", "2027-02-28");

        let memories = on_this_day_impl(&conn, "2028-02-29").unwrap();
        assert_eq!(titles(&memories), vec!["Ordinary 2027", "Leap 2024"]);
        assert_eq!(memories[1].years_ago, 4);

        let the_28th = on_this_day_impl(&conn, "2028-02-28").unwrap();
        assert_eq!(titles(&the_28th), vec!["Ordinary 2027", "Leap 2024"]);
    }

    #[test]
    fn a_memory_carries_its_first_image_if_it_has_one() {
        let conn = crate::db::init_db_at_connection_for_test();
        let with_image = titled_entry(&conn, "Illustrated", "2025-08-16");
        let without = titled_entry(&conn, "Plain", "2024-08-16");

        for (entry, mime, path) in [
            (with_image, "application/pdf", "attachments/1/1.pdf"),
            (with_image, "image/png", "attachments/1/2.png"),
            (with_image, "image/jpeg", "attachments/1/3.jpg"),
            (without, "text/plain", "attachments/2/4.txt"),
        ] {
            conn.execute(
                "INSERT INTO attachments (entry_id, filename, mime_type, size, path) \
                 VALUES (?1, 'f', ?2, 1, ?3)",
                params![entry, mime, path],
            )
            .unwrap();
        }

        let memories = on_this_day_impl(&conn, "2026-08-16").unwrap();
        assert_eq!(
            memories[0].image_path.as_deref(),
            Some("attachments/1/2.png")
        );
        assert_eq!(memories[1].image_path, None);
    }

    #[test]
    fn resurfacing_refuses_a_date_it_cannot_read() {
        let conn = crate::db::init_db_at_connection_for_test();
        for bad in ["", "2026-8-16", "not a date", "2026-02-30"] {
            assert!(
                on_this_day_impl(&conn, bad).is_err(),
                "{bad:?} was accepted"
            );
        }
    }

    #[test]
    fn stepping_between_entries_follows_the_order_the_journal_reads_in() {
        let conn = crate::db::init_db_at_connection_for_test();
        let oldest = write_entry(&conn, "2026-01-01");
        let middle = write_entry(&conn, "2026-06-01");
        let newest = write_entry(&conn, "2026-12-01");

        let from_middle = adjacent_entries_impl(&conn, middle).unwrap();
        assert_eq!(from_middle.previous, Some(oldest));
        assert_eq!(from_middle.next, Some(newest));

        assert_eq!(adjacent_entries_impl(&conn, oldest).unwrap().previous, None);
        assert_eq!(adjacent_entries_impl(&conn, newest).unwrap().next, None);
    }

    #[test]
    fn entries_sharing_a_day_are_still_stepped_through_one_at_a_time() {
        let conn = crate::db::init_db_at_connection_for_test();
        let first = write_entry(&conn, "2026-08-16");
        let second = write_entry(&conn, "2026-08-16");
        let third = write_entry(&conn, "2026-08-16");

        assert_eq!(
            adjacent_entries_impl(&conn, second).unwrap(),
            AdjacentEntriesDto {
                previous: Some(first),
                next: Some(third),
            }
        );
    }

    fn write_spark(conn: &Connection, preview: &str, date: &str) -> i64 {
        conn.execute(
            "INSERT INTO entries (kind, preview, entry_date) VALUES ('spark', ?1, ?2)",
            params![preview, date],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn echoed(conn: &Connection, today: &str) -> Option<String> {
        spark_echo_impl(conn, today)
            .unwrap()
            .map(|echo| echo.preview)
    }

    #[test]
    fn days_from_civil_counts_the_calendar_not_an_approximation() {
        assert_eq!(days_from_civil("1970-01-01"), Some(0));
        assert_eq!(days_from_civil("1970-01-02"), Some(1));
        assert_eq!(days_from_civil("1969-12-31"), Some(-1));
        assert_eq!(
            days_from_civil("2028-03-01").unwrap() - days_from_civil("2028-02-29").unwrap(),
            1
        );
        assert_eq!(
            days_from_civil("1900-03-01").unwrap() - days_from_civil("1900-02-28").unwrap(),
            1
        );
        assert_eq!(
            days_from_civil("2000-03-01").unwrap() - days_from_civil("2000-02-28").unwrap(),
            2
        );
    }

    #[test]
    fn every_candidate_returns_once_before_any_of_them_repeats() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_spark(&conn, "one", "2026-01-01");
        write_spark(&conn, "two", "2026-01-02");
        write_spark(&conn, "three", "2026-01-03");

        let week = [
            "2026-06-01",
            "2026-06-02",
            "2026-06-03",
            "2026-06-04",
            "2026-06-05",
            "2026-06-06",
        ];
        let seen: Vec<String> = week.iter().map(|day| echoed(&conn, day).unwrap()).collect();

        let mut cycle = seen[0..3].to_vec();
        cycle.sort();
        assert_eq!(cycle, vec!["one", "three", "two"]);
        assert_eq!(seen[0..3], seen[3..6]);
    }

    #[test]
    fn the_same_day_always_picks_the_same_spark() {
        let conn = crate::db::init_db_at_connection_for_test();
        for day in 1..=9 {
            write_spark(&conn, &format!("spark {day}"), &format!("2026-01-0{day}"));
        }

        let first = echoed(&conn, "2026-06-01");
        assert!(first.is_some());
        for _ in 0..5 {
            assert_eq!(echoed(&conn, "2026-06-01"), first);
        }
    }

    #[test]
    fn a_spark_is_only_a_candidate_once_it_has_stopped_being_recent() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_spark(&conn, "at the boundary", "2026-05-02");
        assert_eq!(
            echoed(&conn, "2026-06-01").as_deref(),
            Some("at the boundary")
        );

        let newer = crate::db::init_db_at_connection_for_test();
        write_spark(&newer, "still recent", "2026-05-03");
        assert_eq!(echoed(&newer, "2026-06-01"), None);
    }

    #[test]
    fn a_journal_with_no_old_sparks_echoes_nothing_rather_than_failing() {
        let empty = crate::db::init_db_at_connection_for_test();
        assert_eq!(echoed(&empty, "2026-06-01"), None);

        let entries_only = crate::db::init_db_at_connection_for_test();
        titled_entry(&entries_only, "An entry", "2020-01-01");
        assert_eq!(echoed(&entries_only, "2026-06-01"), None);

        let blank = crate::db::init_db_at_connection_for_test();
        write_spark(&blank, "", "2020-01-01");
        assert_eq!(echoed(&blank, "2026-06-01"), None);
    }

    #[test]
    fn one_spark_is_the_echo_every_day() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_spark(&conn, "the only one", "2026-01-01");

        for day in ["2026-06-01", "2026-06-02", "2026-06-03"] {
            assert_eq!(echoed(&conn, day).as_deref(), Some("the only one"));
        }
    }

    #[test]
    fn an_echo_carries_how_long_ago_it_was_written() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_spark(&conn, "a while back", "2026-01-01");

        let echo = spark_echo_impl(&conn, "2026-06-01").unwrap().unwrap();
        assert_eq!(echo.days_ago, 151);
        assert_eq!(echo.entry_date, "2026-01-01");
    }

    #[test]
    fn the_echo_refuses_a_date_it_cannot_read() {
        let conn = crate::db::init_db_at_connection_for_test();
        for bad in ["", "2026-8-16", "not a date", "2026-02-30"] {
            assert!(spark_echo_impl(&conn, bad).is_err(), "{bad:?} was accepted");
        }
    }

    #[test]
    fn an_entry_that_no_longer_exists_has_no_neighbours() {
        let conn = crate::db::init_db_at_connection_for_test();
        write_entry(&conn, "2026-08-16");

        assert_eq!(
            adjacent_entries_impl(&conn, 999).unwrap(),
            AdjacentEntriesDto {
                previous: None,
                next: None,
            }
        );
    }
}
