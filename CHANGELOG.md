# Changelog

## [1.6.0](https://github.com/zademy/lu-yume-speech/compare/v1.5.0...v1.6.0) (2026-08-16)


### Features

* **gate:** añade Puerta de acceso con Frase de acceso (cosmética) ([13a7077](https://github.com/zademy/lu-yume-speech/commit/13a707717284372c429be81434fa43274f1f18ee))


### Bug Fixes

* **gate:** mapa de errores compartido, gate.error.empty y a11y del setup ([d5ebfae](https://github.com/zademy/lu-yume-speech/commit/d5ebfaef9cd8c0b8352a48d6a8a7c6b3026942eb))

## [1.5.0](https://github.com/zademy/lu-yume-speech/compare/v1.4.0...v1.5.0) (2026-08-16)


### Features

* **api:** add transcription provider adapter with Cloudflare Whisper worker ([bf1a3be](https://github.com/zademy/lu-yume-speech/commit/bf1a3bec198e3dcfc5ebf5fe016abbfa74f4e329))
* **api:** add transcription provider adapter with Cloudflare Whisper… ([5cb3baa](https://github.com/zademy/lu-yume-speech/commit/5cb3baae63c065530ace187247038a3276fe2108))

## [1.4.0](https://github.com/zademy/lu-yume-speech/compare/v1.3.0...v1.4.0) (2026-08-11)


### Features

* **build:** sync app version from package.json and container CI ([56d9fb9](https://github.com/zademy/lu-yume-speech/commit/56d9fb9e0a501a8e5a612a0bc74f2c245384788c))


### Bug Fixes

* **pluma:** isolate dictation state from Dictate view on navigation ([0788b15](https://github.com/zademy/lu-yume-speech/commit/0788b159d6e91eee5186fad9670d647eceb7678b))
* **pluma:** move improve star to left, reduce editor font to 12px, fix metrics button spacing ([799d5c7](https://github.com/zademy/lu-yume-speech/commit/799d5c7e233f91909b5b6f10bb0c7045d1e120ff))

## [1.3.0](https://github.com/zademy/lu-yume-speech/compare/v1.2.0...v1.3.0) (2026-08-10)


### Features

* add About view with author info, version, and GitHub link ([49a9cac](https://github.com/zademy/lu-yume-speech/commit/49a9cac63b242866f652fe9eea04b801e374b97c))
* **pluma:** add close button to exit editor and return to empty preview ([7228042](https://github.com/zademy/lu-yume-speech/commit/7228042f2ca220f72f557a0ea4ff0a0f2cc2eaec))
* **pluma:** add dictation append and AI selection improve (T4, T5) ([806b848](https://github.com/zademy/lu-yume-speech/commit/806b8485242e0f396833f2d55e569bbece25bd94))
* **pluma:** add dictation/improve CSS and fix status message ([621b5ae](https://github.com/zademy/lu-yume-speech/commit/621b5ae8d1b9f79a9e9b58ccf4ec815afa94a7ae))
* **pluma:** add Pluma writer view shell + escritos store (T1) ([ce1dae0](https://github.com/zademy/lu-yume-speech/commit/ce1dae0857d4e4085517c9e62a53b3cdc7210383))
* **pluma:** integrate Milkdown editor with lazy-loaded chunk (T2) ([4ac2bb7](https://github.com/zademy/lu-yume-speech/commit/4ac2bb79a961f1465388562ac0cd47b853c9ca2d))
* **pluma:** persist pasted images offline as Dexie blobs (T3) ([43a12b9](https://github.com/zademy/lu-yume-speech/commit/43a12b9cf8fcbdc640a79e204f19a7d5a314aba7))
* **pluma:** place caret at end of document on open ([fa454f7](https://github.com/zademy/lu-yume-speech/commit/fa454f7f96c6d4315e7f3fde7457c8e3dd767b0c))


### Bug Fixes

* **about:** align heading with standard view-heading pattern ([d57e238](https://github.com/zademy/lu-yume-speech/commit/d57e238e91a90e0abcd763e11ce0acf209704520))
* **about:** move description out of flex view-heading to prevent overflow ([9a35826](https://github.com/zademy/lu-yume-speech/commit/9a3582691aaa0d4c66743f5766e017c9308feeaa))
* **ci:** daily calendar versioning with robust GHCR check ([a287428](https://github.com/zademy/lu-yume-speech/commit/a287428e25d80a2ef59503d68d83aaf9df95c482))
* **pluma:** disable dictation toggle when no document is open ([e954894](https://github.com/zademy/lu-yume-speech/commit/e954894879627f15856f2f5931e9ec55c659f417))
* **pluma:** isolate dictation from Dictate view recorder effects ([2680519](https://github.com/zademy/lu-yume-speech/commit/2680519ac3baa8039e183553fe597b16e372b5d8))
* **pluma:** keep dictation target on Pluma until transcription lands ([26a99c9](https://github.com/zademy/lu-yume-speech/commit/26a99c94edb8098d1f477a562e476f8ef15f12fb))
* **pluma:** load crepe component styles (common/style.css) ([9de9ae3](https://github.com/zademy/lu-yume-speech/commit/9de9ae3b73bb2937745020b082668f237569b127))
* **pluma:** load prosemirror base css and define vue feature flags ([d45112b](https://github.com/zademy/lu-yume-speech/commit/d45112b976de31d1a52063488877e58330378ea3))
* **pluma:** remove blank line above dictated text in appendParagraph ([5207a3a](https://github.com/zademy/lu-yume-speech/commit/5207a3ab73479c86964e60d2ca73d3edbe42cc2f))
* **pluma:** resolve editor stack overflow and improve star visibility ([12e240e](https://github.com/zademy/lu-yume-speech/commit/12e240ecf6f25efa8185ed28542c82d0cb370227))


### Performance Improvements

* **docker:** build SPA on native platform for multi-arch images ([d4fc45d](https://github.com/zademy/lu-yume-speech/commit/d4fc45d07bcd5f7084891b6000d2dab23e81ad4b))

## [1.2.0](https://github.com/zademy/lu-yume-speech/compare/v1.1.0...v1.2.0) (2026-08-10)


### Features

* **audio:** DSP filter chain + RNNoise neural noise suppression ([f489117](https://github.com/zademy/lu-yume-speech/commit/f489117876d0b82e2cfb2cc15f8dfa2adb3161c0))
* delete sandcastle ([a9e3615](https://github.com/zademy/lu-yume-speech/commit/a9e3615f1f976618b2768ec977efe15f1f6f9732))
* **groq:** timeout, abort, retry/backoff, Zod validation, typed errors ([04142dd](https://github.com/zademy/lu-yume-speech/commit/04142dd5d2c42f39f5b67f9c4935a0b60d8e80af))
* **history:** Implement history sidebar with restore, delete, and clear functionality ([1acf970](https://github.com/zademy/lu-yume-speech/commit/1acf97013d24e64f26e00f9723a7e92c780ed32a))
* **history:** Initialize history sidebar and project setup ([3401266](https://github.com/zademy/lu-yume-speech/commit/340126665858e063822c2a7da24b2a8c17087345))
* **history:** store audio in IndexedDB, add play/download buttons ([d3e82c4](https://github.com/zademy/lu-yume-speech/commit/d3e82c49ffc289822b0d64fbcf7d8ec40c5380eb))
* **i18n:** add app-language setting with EN default and ES ([ed54f36](https://github.com/zademy/lu-yume-speech/commit/ed54f3653cfbaaf9be5972646c5ddf69f91da2fe))
* Initialize project with basic files and configurations ([c604986](https://github.com/zademy/lu-yume-speech/commit/c604986dbb0c3bee46bb5f57341ce376397cd78b))
* **platform:** Rust keychain commands + TS bridge, wire GroqClient via DI ([b5fb8fa](https://github.com/zademy/lu-yume-speech/commit/b5fb8fa131db9e62aa78805575e9b2a4f952e03f))
* **storage:** persist structured data in IndexedDB/Dexie + Métricas panel ([10148fe](https://github.com/zademy/lu-yume-speech/commit/10148fe3116329aeaf66333c22be3a6c4f2c9037))
* **summary:** add transcript summaries ([3b1bac0](https://github.com/zademy/lu-yume-speech/commit/3b1bac0109512b383960db1933bae230715ae3a2))
* **tauri:** scaffold desktop shell (Rust backend, CSP, capabilities) ([d915c00](https://github.com/zademy/lu-yume-speech/commit/d915c002c919210664b46d1a518ea8711044441a))
* **ui:** Implement history sidebar with restore, delete, and clear functionality ([0a70175](https://github.com/zademy/lu-yume-speech/commit/0a701757e48ae3f006745e1f4bd0c8938a100ae1))
* **ui:** Implement history sidebar with restore, delete, and clear functionality and initialize minimax persist file ([6ead997](https://github.com/zademy/lu-yume-speech/commit/6ead9971932788c12f8154c85e7da93b02510a31))
* **ui:** improved recording animation — smoothing, glow, REC indicator ([e0c7872](https://github.com/zademy/lu-yume-speech/commit/e0c7872a2ed7cd15096981eb771ae61162210460))
* **ui:** settings modal replaces &lt;details&gt; collapse ([f158839](https://github.com/zademy/lu-yume-speech/commit/f158839c95b5c3e5b02ff3cb64285815495f555a))
* update ([c1d3eb0](https://github.com/zademy/lu-yume-speech/commit/c1d3eb0d49cf35e32dafe85f69e15f6dff02c8f3))
* update ([66441c4](https://github.com/zademy/lu-yume-speech/commit/66441c49ae30a9dfd3fce324b8e0cc9a358df899))
* update ([d7fdea4](https://github.com/zademy/lu-yume-speech/commit/d7fdea4c548aea2ea6143fdd30dc57c7c2f11a0d))
* update ([94f9a9c](https://github.com/zademy/lu-yume-speech/commit/94f9a9cfd8c93f0c7c1ed74e7300cf2d54599b95))


### Bug Fixes

* **audio:** guard navigator.mediaDevices, add RecordingTimer.dispose() ([4f96dfb](https://github.com/zademy/lu-yume-speech/commit/4f96dfbbea0757a609c714bb698e0941eef41844))
* **history:** Initialize history sidebar and project setup and update sessionChangedPaths ([bf26440](https://github.com/zademy/lu-yume-speech/commit/bf26440df42a503da0375a47e602f08da9649322))
* **history:** Initialize history sidebar and project setup and update… ([4c510dd](https://github.com/zademy/lu-yume-speech/commit/4c510dd4fd5f0d449a6d812761b3f5e503b9d55d))
* **storage:** classify QuotaExceeded vs corrupt JSON with warnings ([3e73084](https://github.com/zademy/lu-yume-speech/commit/3e73084b5fe7ba36fb235b90e68ee16598883619))
* **theme:** align no-flash script with stt_ storage prefix ([f7960b7](https://github.com/zademy/lu-yume-speech/commit/f7960b79bd54be16ff25e9aba2fd07c3933c1b60))
* **ui:** add API key modal when no key detected (web dev mode) ([0e54358](https://github.com/zademy/lu-yume-speech/commit/0e543580880a8932be153c5ce814e847f997ec82))
* **ui:** render settings modal on document.body to escape overflow containment ([952e210](https://github.com/zademy/lu-yume-speech/commit/952e2104dfbfdeb99d1f9907833848a450e835ab))

## [1.1.0](https://github.com/zademy/lu-yume-speech/compare/v1.0.0...v1.1.0) (2026-08-10)


### Features

* **storage:** persist structured data in IndexedDB/Dexie + Métricas panel ([10148fe](https://github.com/zademy/lu-yume-speech/commit/10148fe3116329aeaf66333c22be3a6c4f2c9037))

## 1.0.0 (2026-08-10)


### Features

* **audio:** DSP filter chain + RNNoise neural noise suppression ([f489117](https://github.com/zademy/lu-yume-speech/commit/f489117876d0b82e2cfb2cc15f8dfa2adb3161c0))
* delete sandcastle ([a9e3615](https://github.com/zademy/lu-yume-speech/commit/a9e3615f1f976618b2768ec977efe15f1f6f9732))
* **groq:** timeout, abort, retry/backoff, Zod validation, typed errors ([04142dd](https://github.com/zademy/lu-yume-speech/commit/04142dd5d2c42f39f5b67f9c4935a0b60d8e80af))
* **history:** Implement history sidebar with restore, delete, and clear functionality ([1acf970](https://github.com/zademy/lu-yume-speech/commit/1acf97013d24e64f26e00f9723a7e92c780ed32a))
* **history:** Initialize history sidebar and project setup ([3401266](https://github.com/zademy/lu-yume-speech/commit/340126665858e063822c2a7da24b2a8c17087345))
* **history:** store audio in IndexedDB, add play/download buttons ([d3e82c4](https://github.com/zademy/lu-yume-speech/commit/d3e82c49ffc289822b0d64fbcf7d8ec40c5380eb))
* Initialize project with basic files and configurations ([c604986](https://github.com/zademy/lu-yume-speech/commit/c604986dbb0c3bee46bb5f57341ce376397cd78b))
* **platform:** Rust keychain commands + TS bridge, wire GroqClient via DI ([b5fb8fa](https://github.com/zademy/lu-yume-speech/commit/b5fb8fa131db9e62aa78805575e9b2a4f952e03f))
* **summary:** add transcript summaries ([3b1bac0](https://github.com/zademy/lu-yume-speech/commit/3b1bac0109512b383960db1933bae230715ae3a2))
* **tauri:** scaffold desktop shell (Rust backend, CSP, capabilities) ([d915c00](https://github.com/zademy/lu-yume-speech/commit/d915c002c919210664b46d1a518ea8711044441a))
* **ui:** Implement history sidebar with restore, delete, and clear functionality ([0a70175](https://github.com/zademy/lu-yume-speech/commit/0a701757e48ae3f006745e1f4bd0c8938a100ae1))
* **ui:** Implement history sidebar with restore, delete, and clear functionality and initialize minimax persist file ([6ead997](https://github.com/zademy/lu-yume-speech/commit/6ead9971932788c12f8154c85e7da93b02510a31))
* **ui:** improved recording animation — smoothing, glow, REC indicator ([e0c7872](https://github.com/zademy/lu-yume-speech/commit/e0c7872a2ed7cd15096981eb771ae61162210460))
* **ui:** settings modal replaces &lt;details&gt; collapse ([f158839](https://github.com/zademy/lu-yume-speech/commit/f158839c95b5c3e5b02ff3cb64285815495f555a))
* update ([c1d3eb0](https://github.com/zademy/lu-yume-speech/commit/c1d3eb0d49cf35e32dafe85f69e15f6dff02c8f3))
* update ([66441c4](https://github.com/zademy/lu-yume-speech/commit/66441c49ae30a9dfd3fce324b8e0cc9a358df899))
* update ([d7fdea4](https://github.com/zademy/lu-yume-speech/commit/d7fdea4c548aea2ea6143fdd30dc57c7c2f11a0d))
* update ([94f9a9c](https://github.com/zademy/lu-yume-speech/commit/94f9a9cfd8c93f0c7c1ed74e7300cf2d54599b95))


### Bug Fixes

* **audio:** guard navigator.mediaDevices, add RecordingTimer.dispose() ([4f96dfb](https://github.com/zademy/lu-yume-speech/commit/4f96dfbbea0757a609c714bb698e0941eef41844))
* **history:** Initialize history sidebar and project setup and update sessionChangedPaths ([bf26440](https://github.com/zademy/lu-yume-speech/commit/bf26440df42a503da0375a47e602f08da9649322))
* **history:** Initialize history sidebar and project setup and update… ([4c510dd](https://github.com/zademy/lu-yume-speech/commit/4c510dd4fd5f0d449a6d812761b3f5e503b9d55d))
* **storage:** classify QuotaExceeded vs corrupt JSON with warnings ([3e73084](https://github.com/zademy/lu-yume-speech/commit/3e73084b5fe7ba36fb235b90e68ee16598883619))
* **theme:** align no-flash script with stt_ storage prefix ([f7960b7](https://github.com/zademy/lu-yume-speech/commit/f7960b79bd54be16ff25e9aba2fd07c3933c1b60))
* **ui:** add API key modal when no key detected (web dev mode) ([0e54358](https://github.com/zademy/lu-yume-speech/commit/0e543580880a8932be153c5ce814e847f997ec82))
* **ui:** render settings modal on document.body to escape overflow containment ([952e210](https://github.com/zademy/lu-yume-speech/commit/952e2104dfbfdeb99d1f9907833848a450e835ab))
