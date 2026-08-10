# Changelog

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
