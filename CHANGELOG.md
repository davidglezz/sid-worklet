# Changelog

## [1.1.0](https://github.com/davidglezz/sid-worklet/compare/v1.0.0...v1.1.0) (2026-11-07)


### Features

* **sid2wasm:** translate SID 6502 code to WebAssembly ([1af35d3](https://github.com/davidglezz/sid-worklet/commit/1af35d387f51246905ec186cb39b4a82553f6598))
* **ui:** show subsong selector only for multi-subsong songs ([6c98461](https://github.com/davidglezz/sid-worklet/commit/6c98461b4a3d60291738f3e9c3a597c8835710dc))


### Bug Fixes

* **audio-player:** guard operations until the worklet is ready ([46fc081](https://github.com/davidglezz/sid-worklet/commit/46fc081b40b88059e23c753df64862227b43a77e))
* **audio-visualizer:** avoid parsing the CSS color for frequency bars ([ae4fcd8](https://github.com/davidglezz/sid-worklet/commit/ae4fcd8f03fb2f19d3765384cd08f8e9f7ccda3e))
* **audio-visualizer:** validate the 2D context before using it ([3637598](https://github.com/davidglezz/sid-worklet/commit/3637598cfdc1958f41073bd7b66553faa386fb34))
* **ci:** install sid2wasm dependencies through the pnpm workspace ([559595c](https://github.com/davidglezz/sid-worklet/commit/559595c71ab7c7beb163581e8609e473d14af1a5))
* **sid2wasm:** satisfy no-floating-promises in compare test ([3c1e925](https://github.com/davidglezz/sid-worklet/commit/3c1e925cb497d96a92d340d81bb651fe920d235b))
* **sid:** parse the 16-bit data offset and honor the header load address ([9d513a6](https://github.com/davidglezz/sid-worklet/commit/9d513a6a9dca357f6e21cc58056ea62a41b1bb93))
* **sid:** parse the 16-bit song count and preferred start song ([49f24d8](https://github.com/davidglezz/sid-worklet/commit/49f24d820102547ca423c5679136304302f6377f))
* **ui:** cancel the previous song-list render before parsing ([0bb554f](https://github.com/davidglezz/sid-worklet/commit/0bb554f32273b9989fdb7d87d4c473412b992cb1))
* **ui:** drop the subsongs label and pad every list duration ([3d0eb3a](https://github.com/davidglezz/sid-worklet/commit/3d0eb3a27142b989845de1fb44efa9fe20f9e487))
* **ui:** handle async loading and playback errors ([03adc5f](https://github.com/davidglezz/sid-worklet/commit/03adc5fe9130f80a7577a347a0c0cf2bbf49c395))
* **ui:** keep sticky author headers above song rows ([aefea26](https://github.com/davidglezz/sid-worklet/commit/aefea269bcebf12b566983b4fcc1cdf0e1e4fbac))
* **ui:** place the random button above the volume and start playback ([fefc9b9](https://github.com/davidglezz/sid-worklet/commit/fefc9b9a47ae92916f8b6e3e83d50ef18bc32895))
* **ui:** restore content-visibility for song list sections ([18c18ee](https://github.com/davidglezz/sid-worklet/commit/18c18ee4a143d24448c23bf97c4f524bf396f4f7))
* **ui:** show subsong count and unpadded total duration in the song list ([eb8f6dc](https://github.com/davidglezz/sid-worklet/commit/eb8f6dc83c9e3ffe2ce15b94687b3b3ad3f987b6))
* **worklet:** harden message dispatch and output channels ([97b0e5c](https://github.com/davidglezz/sid-worklet/commit/97b0e5c1133191a289ea7be6cbe25f44b2041548))
* **worklet:** surface SID load errors to the player ([65cfbff](https://github.com/davidglezz/sid-worklet/commit/65cfbff8799c1e02f05861700d3a10c49afd12ab))


### Performance Improvements

* **cpu:** cache addressing results and drop unused IR ([1ffdc01](https://github.com/davidglezz/sid-worklet/commit/1ffdc012102afbefab4590a6ddb63d9b4276661d))
* **seek:** run seek fast-forward in a worker ([dc5d8f1](https://github.com/davidglezz/sid-worklet/commit/dc5d8f1cbc832cb6cc42d9b7d688931ae2962b53))
* **sid:** add batch render API for the audio worklet ([37747d5](https://github.com/davidglezz/sid-worklet/commit/37747d5d4ab6680e2e42c413b95dcda8d88b7f31))
* **sid:** cache filter cutoff and resonance coefficients ([ca5fcfa](https://github.com/davidglezz/sid-worklet/commit/ca5fcfa18c398f7f7a85d81c0c8cdced8962ddeb))
* **sid:** hoist per-sample and per-tick constants ([7f8e56f](https://github.com/davidglezz/sid-worklet/commit/7f8e56f7ce0ede3845782bb6978a23aea15ec45c))
* **sid:** keep filter/output accumulators in locals ([b511e69](https://github.com/davidglezz/sid-worklet/commit/b511e69a578f9e9dd0eb7a4d8e75f340abbb0f87))
* **sid:** reuse preallocated checkpoint buffers ([bb5da93](https://github.com/davidglezz/sid-worklet/commit/bb5da936beb0bde176b654bd72cc0f655b9ef806))
* **sid:** store page-delta checkpoints every 5 seconds ([200df8f](https://github.com/davidglezz/sid-worklet/commit/200df8fbfa139ef2f6929445f15c8fee4239d040))
* **sid:** use typed waveform tables and bit-shift filter routing ([af8cebe](https://github.com/davidglezz/sid-worklet/commit/af8cebe7fd5cb80add6e09dc037cef0055baad43))
* **ui:** render the 60k-entry song list in asynchronous batches ([5e3bd6a](https://github.com/davidglezz/sid-worklet/commit/5e3bd6a935527be96ef62e96e6f9476f74777a78))

## 1.0.0 (2026-05-17)

### Features

- add fetch-songlist script ([b36b4e3](https://github.com/davidglezz/sid-worklet/commit/b36b4e3266f8ae90a0d794b9cceb661f9fb56666))
- add keyboard shortcuts — Space play/pause, ←/→ seek ±5s, ↑/↓ volume ±10%, M mute toggle ([1d555cc](https://github.com/davidglezz/sid-worklet/commit/1d555ccf9607cc57a1f19e3889202f3afdc85cc3))
- add PlayerErrorEvent with dispatch+rethrow in load(), show error in UI title ([e08df8e](https://github.com/davidglezz/sid-worklet/commit/e08df8e57c716993f01bf5c0878300817b943b68))
- add random song selection for playback ([43819a5](https://github.com/davidglezz/sid-worklet/commit/43819a5bc47058ade4e2b74b301a404fdd20764a))
- add SongInfo interface, remove all any types from message layer ([fb08e89](https://github.com/davidglezz/sid-worklet/commit/fb08e89ac1af5f30ec79cd096c21d21332277027))
- **cpu:** refactor state management using typed arrays for CPU emulator ([1c493b8](https://github.com/davidglezz/sid-worklet/commit/1c493b8171096a3e785005c4b51ddc1fde1e94d7))
- display song author and title ([483abbd](https://github.com/davidglezz/sid-worklet/commit/483abbdc14d7f0d12c8be50b8a09dc3c56ea731b))
- display song duration in song list ([6bb06ab](https://github.com/davidglezz/sid-worklet/commit/6bb06ab3b87f045cb6b63719f9ed2c621db23da4))
- display song time and subsong selector ([407fefd](https://github.com/davidglezz/sid-worklet/commit/407fefd87cd1aa780fe1a70a00b04cd1bbe0eb72))
- enable sticky positioning for list sections ([c75541f](https://github.com/davidglezz/sid-worklet/commit/c75541f68307e37cb13aed06c9ee38a128aa6aa5))
- fix play button content ([49397df](https://github.com/davidglezz/sid-worklet/commit/49397df0aaafb00801e08bcbc1ce099621a7c7dc))
- implement seek ([a297d4c](https://github.com/davidglezz/sid-worklet/commit/a297d4c02e084e2639fe86790d046fda45595a28))
- improve names and titles ([ecf959b](https://github.com/davidglezz/sid-worklet/commit/ecf959bda601b5a6512ea7d69d2aed5153982b06))
- initial commit ([759b0e8](https://github.com/davidglezz/sid-worklet/commit/759b0e830c859193d914874485f1c2b1a85def56))
- list all songs and improve list performance ([fed5b05](https://github.com/davidglezz/sid-worklet/commit/fed5b056034b55d371fb93169e0485d31f96b6a5))
- on() returns unsubscribe function to allow removing event listeners ([113ed86](https://github.com/davidglezz/sid-worklet/commit/113ed865d24bb4226f7e74a2cec3d1dd05321ce6))
- play btn class based state ([bbae433](https://github.com/davidglezz/sid-worklet/commit/bbae433a27ddf91c834e91a24166d840fb9c645c))
- remove unused TextDecoder polyfill ([89d9ca4](https://github.com/davidglezz/sid-worklet/commit/89d9ca471eb190b288da643a25be4cb91d44986a))
- scroll to the active song link ([bd7b450](https://github.com/davidglezz/sid-worklet/commit/bd7b45030eb91a23c745b6acdcb7bc50352d3209))
- **sid-device:** use ArrayBuffer for SID internal state ([895a6b8](https://github.com/davidglezz/sid-worklet/commit/895a6b85d6575b8623d730f1ff0d456fedabb1a6))
- update song title and time display in controls ([72b8bb1](https://github.com/davidglezz/sid-worklet/commit/72b8bb16399761ed6574e82f4762a7865e887d25))
- use absolute seek ([bd4f2ef](https://github.com/davidglezz/sid-worklet/commit/bd4f2ef835eedce9803c044edc0629c9a489ac2e))
- wire Duration into SongInfo — setDuration message from main thread to worklet ([57a0ad1](https://github.com/davidglezz/sid-worklet/commit/57a0ad13dcc5f8180dc7034a8208c1ec2365cb25))

### Bug Fixes

- guard load() with readyPromise to prevent race condition before AudioWorklet is ready ([fc103c4](https://github.com/davidglezz/sid-worklet/commit/fc103c4989d30bf5a73f687ac31f4b4ef40c63d2))
- harden TextDecoder polyfill — guard, loop instead of spread, explicit return type ([b6e5658](https://github.com/davidglezz/sid-worklet/commit/b6e565804b36f5bc6a752c497de9f244102933b7))
- merge SID_model variables ([7ae94bb](https://github.com/davidglezz/sid-worklet/commit/7ae94bba237a47e1cf8dc62fe2b2dd7aabbea4aa))
- rename isEndded -&gt; isEnded (typo from original jsSID source) ([7965d4f](https://github.com/davidglezz/sid-worklet/commit/7965d4f10151fd30fe027f07ec275d11f2762f99))

### Performance Improvements

- add 30s seek checkpoints — getState/setState on CPU and SID, seek restores nearest snapshot ([ce45238](https://github.com/davidglezz/sid-worklet/commit/ce4523840783c24cf71d42c84c1a07846804106f))
- improve cpu and sid perf ([edc592f](https://github.com/davidglezz/sid-worklet/commit/edc592fbce81ea3c49d2ce79712cf9023a2e16d7))
