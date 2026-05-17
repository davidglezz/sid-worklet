# Changelog

## 1.0.0 (2026-05-17)


### Features

* add fetch-songlist script ([b36b4e3](https://github.com/davidglezz/sid-worklet/commit/b36b4e3266f8ae90a0d794b9cceb661f9fb56666))
* add keyboard shortcuts — Space play/pause, ←/→ seek ±5s, ↑/↓ volume ±10%, M mute toggle ([1d555cc](https://github.com/davidglezz/sid-worklet/commit/1d555ccf9607cc57a1f19e3889202f3afdc85cc3))
* add PlayerErrorEvent with dispatch+rethrow in load(), show error in UI title ([e08df8e](https://github.com/davidglezz/sid-worklet/commit/e08df8e57c716993f01bf5c0878300817b943b68))
* add random song selection for playback ([43819a5](https://github.com/davidglezz/sid-worklet/commit/43819a5bc47058ade4e2b74b301a404fdd20764a))
* add SongInfo interface, remove all any types from message layer ([fb08e89](https://github.com/davidglezz/sid-worklet/commit/fb08e89ac1af5f30ec79cd096c21d21332277027))
* **cpu:** refactor state management using typed arrays for CPU emulator ([1c493b8](https://github.com/davidglezz/sid-worklet/commit/1c493b8171096a3e785005c4b51ddc1fde1e94d7))
* display song author and title ([483abbd](https://github.com/davidglezz/sid-worklet/commit/483abbdc14d7f0d12c8be50b8a09dc3c56ea731b))
* display song duration in song list ([6bb06ab](https://github.com/davidglezz/sid-worklet/commit/6bb06ab3b87f045cb6b63719f9ed2c621db23da4))
* display song time and subsong selector ([407fefd](https://github.com/davidglezz/sid-worklet/commit/407fefd87cd1aa780fe1a70a00b04cd1bbe0eb72))
* enable sticky positioning for list sections ([c75541f](https://github.com/davidglezz/sid-worklet/commit/c75541f68307e37cb13aed06c9ee38a128aa6aa5))
* fix play button content ([49397df](https://github.com/davidglezz/sid-worklet/commit/49397df0aaafb00801e08bcbc1ce099621a7c7dc))
* implement seek ([a297d4c](https://github.com/davidglezz/sid-worklet/commit/a297d4c02e084e2639fe86790d046fda45595a28))
* improve names and titles ([ecf959b](https://github.com/davidglezz/sid-worklet/commit/ecf959bda601b5a6512ea7d69d2aed5153982b06))
* initial commit ([759b0e8](https://github.com/davidglezz/sid-worklet/commit/759b0e830c859193d914874485f1c2b1a85def56))
* list all songs and improve list performance ([fed5b05](https://github.com/davidglezz/sid-worklet/commit/fed5b056034b55d371fb93169e0485d31f96b6a5))
* on() returns unsubscribe function to allow removing event listeners ([113ed86](https://github.com/davidglezz/sid-worklet/commit/113ed865d24bb4226f7e74a2cec3d1dd05321ce6))
* play btn class based state ([bbae433](https://github.com/davidglezz/sid-worklet/commit/bbae433a27ddf91c834e91a24166d840fb9c645c))
* remove unused TextDecoder polyfill ([89d9ca4](https://github.com/davidglezz/sid-worklet/commit/89d9ca471eb190b288da643a25be4cb91d44986a))
* scroll to the active song link ([bd7b450](https://github.com/davidglezz/sid-worklet/commit/bd7b45030eb91a23c745b6acdcb7bc50352d3209))
* **sid-device:** use ArrayBuffer for SID internal state ([895a6b8](https://github.com/davidglezz/sid-worklet/commit/895a6b85d6575b8623d730f1ff0d456fedabb1a6))
* update song title and time display in controls ([72b8bb1](https://github.com/davidglezz/sid-worklet/commit/72b8bb16399761ed6574e82f4762a7865e887d25))
* use absolute seek ([bd4f2ef](https://github.com/davidglezz/sid-worklet/commit/bd4f2ef835eedce9803c044edc0629c9a489ac2e))
* wire Duration into SongInfo — setDuration message from main thread to worklet ([57a0ad1](https://github.com/davidglezz/sid-worklet/commit/57a0ad13dcc5f8180dc7034a8208c1ec2365cb25))


### Bug Fixes

* guard load() with readyPromise to prevent race condition before AudioWorklet is ready ([fc103c4](https://github.com/davidglezz/sid-worklet/commit/fc103c4989d30bf5a73f687ac31f4b4ef40c63d2))
* harden TextDecoder polyfill — guard, loop instead of spread, explicit return type ([b6e5658](https://github.com/davidglezz/sid-worklet/commit/b6e565804b36f5bc6a752c497de9f244102933b7))
* merge SID_model variables ([7ae94bb](https://github.com/davidglezz/sid-worklet/commit/7ae94bba237a47e1cf8dc62fe2b2dd7aabbea4aa))
* rename isEndded -&gt; isEnded (typo from original jsSID source) ([7965d4f](https://github.com/davidglezz/sid-worklet/commit/7965d4f10151fd30fe027f07ec275d11f2762f99))


### Performance Improvements

* add 30s seek checkpoints — getState/setState on CPU and SID, seek restores nearest snapshot ([ce45238](https://github.com/davidglezz/sid-worklet/commit/ce4523840783c24cf71d42c84c1a07846804106f))
* improve cpu and sid perf ([edc592f](https://github.com/davidglezz/sid-worklet/commit/edc592fbce81ea3c49d2ce79712cf9023a2e16d7))
