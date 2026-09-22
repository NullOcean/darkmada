//! Poll display brightness and reapply linked RGB brightness on changes.

use crate::{display_brightness_helper, Controller};
use anyhow::Result;
use std::thread;
use std::time::Duration;

/// Keep the RGB LEDs in sync with the display while the system is running.
pub fn watch_brightness(controller: &Controller, interval: Duration) -> Result<()> {
    let mut previous_brightness: Option<u8> = None;
    let mut last_error: Option<String> = None;

    loop {
        match display_brightness_helper::screen_brightness_percent() {
            Ok(brightness) => {
                if previous_brightness
                    .map(|previous| previous != brightness)
                    .unwrap_or(false)
                {
                    if let Some(reason) = controller.apply()? {
                        eprintln!("RGB unsupported: {reason}");
                    }
                }
                previous_brightness = Some(brightness);
                last_error = None;
            }
            Err(error) => {
                let message = format!("{error:#}");
                if last_error.as_deref() != Some(message.as_str()) {
                    eprintln!("screen brightness watcher: {message}");
                    last_error = Some(message);
                }
            }
        }

        thread::sleep(interval);
    }
}
