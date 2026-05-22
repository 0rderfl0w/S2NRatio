# Privacy Policy

Effective date: May 22, 2026

S2NRatio is a local-first Chrome extension for tracking Signal vs Noise browsing time.

## Data S2NRatio Stores

S2NRatio stores extension data locally in Chrome storage on your device:

- website domains, such as `example.com`
- Signal or Noise classifications for domains
- daily time totals by domain
- extension settings, such as daily goal, prompt behavior, and status tiers

S2NRatio does not store full URLs, page paths, query strings, page titles, page contents, form entries, keystroke contents, passwords, or payment details.

## How Data Is Used

The extension uses local data to:

- calculate your daily Signal-to-Noise ratio
- show your website time breakdown
- remember how you classify websites
- stop counting stale tabs after inactivity
- export your own CSV data when you request it

## Data Sharing

S2NRatio does not sell, rent, transfer, or share your browsing data.

S2NRatio does not send tracking data to an external server. CSV export is user-triggered and stays under your control.

## Chrome Permissions

S2NRatio requests:

- `tabs` to detect the active tab and current domain
- `storage` to save local settings, rules, and daily totals
- `alarms` to run periodic tracking checkpoints
- `idle` to stop website tracking when your computer is idle or locked
- `<all_urls>` host access to run the local classifier prompt and activity listener on visited pages

These permissions are used only for the extension's single purpose: helping you track active browser time as Signal or Noise.

## Data Retention and Deletion

Daily tracking data is stored locally. You can reset today's tracking data from the extension Settings page.

You can remove all extension data by uninstalling S2NRatio from Chrome or clearing the extension's site data through Chrome.

## Contact

For questions or issues, open an issue on GitHub:

https://github.com/0rderfl0w/S2NRatio/issues
