# LinguaReader project rules

The permanent product rulebook is [LINGUAREADER-MASTER-PROMPT-v5.md](LINGUAREADER-MASTER-PROMPT-v5.md).

Follow it on every LinguaReader change.

Hard limits that also stay in force:

- No user accounts, no tracking, no ads, no hardcoded secrets.
- Do not change `com.linguareader.app`.
- Books, progress, voices, and backups stay on the device.
- Do not replace the current reader with a new speech system in one step. Stability wins. Move platform differences into adapters only when the four platforms still play.
- Android Chrome, the Android app, iPhone Chrome, and Windows Chrome must all still read after any change.
- Ship the knowledge base, Android package, website files, and source zip together only when behavior or the version number changes.
