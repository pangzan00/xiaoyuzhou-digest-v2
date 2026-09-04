# Privacy

小宇宙 Digest is a bring-your-own-key Chrome extension. It has no account system, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature you use, 小宇宙 Digest handles:

- the episode ID (a 24-character hex string) of the active Xiaoyuzhou episode;
- the public audio URL of that episode;
- the transcript text and timestamps produced by the configured DashScope ASR model;
- episode metadata such as title, podcast name, description, and duration;
- text you select in the transcript and nearby transcript context;
- transcript context around a timestamped note;
- notes you save;
- DashScope and DeepSeek configuration, including your API keys; and
- cached transcript and digest results.

## Where data goes

### Alibaba Cloud DashScope

小宇宙 Digest sends the episode's public audio URL to DashScope's paraformer-v2 offline batch endpoint (`dashscope.aliyuncs.com` and its result CDN) for speech-to-text. The transcript result is downloaded from a DashScope result URL.

### DeepSeek

The published version sends AI feature content to DeepSeek V4 Flash at `https://api.deepseek.com`:

- transcript plus relevant title, podcast name, description, or duration for an overview;
- selected text plus nearby transcript context for an explanation; and
- nearby transcript context and episode metadata when polishing a saved note.

Requests go directly from the extension to DashScope and DeepSeek. They are authenticated with the keys you supply. 小宇宙 Digest's developer does not proxy or receive these requests.

Those services process data under their own terms, privacy policies, retention practices, and account settings. Do not send confidential, personal, or regulated content unless their terms and your obligations permit it.

## Local storage and retention

小宇宙 Digest uses Chrome's local extension storage, not a cloud service.

- DashScope and DeepSeek settings and API keys remain on the device in Chrome's extension storage.
- Saved notes remain until you delete them or remove/clear the extension's data. The extension keeps up to 100 notes.
- Recent transcript and digest cache entries are stored locally. The cache is limited to 20 episodes, and entries older than 30 days are removed when the side panel opens.

Chrome extension storage is not a password vault. Anyone with sufficient access to your browser profile or device may be able to recover locally stored keys or content. Use scoped keys where providers support them, set spending limits, and rotate or revoke a key if the device or browser profile is compromised.

To remove data:

- delete individual saved notes in 小宇宙 Digest;
- use the Options page to clear cached digests, delete all notes, or reset all extension data;
- remove the extension or clear its stored data from Chrome to delete all local settings, keys, notes, and cache entries; and
- revoke keys in the DashScope and DeepSeek dashboards to stop their future use.

Clearing local data does not delete information already processed or retained by DashScope or DeepSeek. Use each service's controls for service-side requests.

## Permissions

小宇宙 Digest uses Chrome permissions for these purposes:

- `sidePanel`: display the 小宇宙 Digest interface beside Xiaoyuzhou.
- `storage`: store settings, keys, notes, and cached results locally.
- `tabs`: identify and interact with the active Xiaoyuzhou tab.
- `scripting`: coordinate the extension's Xiaoyuzhou page controls.
- Xiaoyuzhou host access: read the active episode's URL and metadata and provide timestamp controls.
- DashScope host access: transcribe episode audio via paraformer-v2.
- DeepSeek host access: provide AI overviews, explanations, and note polishing through DeepSeek V4 Flash.

小宇宙 Digest does not use these permissions to monitor general browsing activity.

## No sale or advertising use

小宇宙 Digest does not sell personal information, build advertising profiles, or share data with data brokers. It does not include analytics SDKs.

## Changes

Privacy-relevant changes will be documented in this file and in the repository history. Review updates before installing a new version.

## Questions

This repository does not provide a public support or issue channel. Review this policy, the source code, and each provider's documentation before using the extension. For a vulnerability or accidental secret exposure, follow the private process in [SECURITY.md](SECURITY.md).
