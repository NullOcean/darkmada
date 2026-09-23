//! Helpers for adjusting RGB saturation without converting color spaces.

/// Apply an HSV-style saturation adjustment directly to RGB channels.
///
/// The brightest input channel is kept as the anchor. At 100% saturation the
/// original color is returned. As saturation decreases, every other channel
/// moves toward that brightest channel while the anchor remains unchanged.
/// This preserves the RGB representation used by the lighting controller and
/// avoids repeated RGB/HSV conversions.
pub(crate) fn rgb_after_saturation([red, green, blue]: [u8; 3], saturation: u8) -> [u8; 3] {
    let highest_channel: u16 = u16::from(red.max(green).max(blue));
    let saturation: u16 = u16::from(saturation.min(100));
    let desaturation: u16 = 100 - saturation;

    let adjust = |channel: u8| -> u8 {
        let channel: u16 = u16::from(channel);
        let gap: u16 = highest_channel - channel;
        let movement: u16 = (gap * desaturation + 50) / 100;
        (channel + movement) as u8
    };

    [adjust(red), adjust(green), adjust(blue)]
}

#[cfg(test)]
mod tests {
    use super::rgb_after_saturation;

    #[test]
    fn preserves_original_color_at_full_saturation() {
        assert_eq!(rgb_after_saturation([255, 165, 0], 100), [255, 165, 0]);
    }

    #[test]
    fn moves_pure_red_halfway_toward_white() {
        assert_eq!(rgb_after_saturation([255, 0, 0], 50), [255, 128, 128]);
    }

    #[test]
    fn moves_orange_to_white_at_zero_saturation() {
        assert_eq!(rgb_after_saturation([255, 165, 0], 0), [255, 255, 255]);
    }

    #[test]
    fn clamps_saturation_above_one_hundred() {
        assert_eq!(rgb_after_saturation([255, 165, 0], 255), [255, 165, 0]);
    }
}
