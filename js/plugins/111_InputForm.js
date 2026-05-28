//=============================================================================
// 111_InputForm.js
//=============================================================================

/*:
 * @plugindesc フォーム作って文字入力（独自描画フォーム版）
 * @author １１１, くらむぼん / embedded patch
 *
 * @help InputForm x=350;y=200;v=11;max=5;
 * みたいな感じで。この例だとx350,y200の位置に表示、結果を11番の変数に保存。
 * 最大文字数は5（maxは省略すれば無制限にもできる）
 *
 * 時間切れなどを作りたい時は、if_s=3;を付けると
 * ”スイッチ３がONになった場合”に強制終了できます。
 *
 * この版での主な修正：
 * - CSSで見せるHTMLフォーム方式をやめ、ゲーム画面内にSprite/Bitmapで入力欄を描画
 * - 旧CSS版に合わせ、中央揃え・横長の半透明黒バーとして表示
 * - PCでは透明DOM inputをクリック対象にしないため、周囲のクリック処理を握りつぶさない
 * - スマホ/アプリ環境では、キーボード表示用に透明DOM inputを入力欄上だけに重ねる
 * - Input.form_mode中でもTouchInputを止めないため、PictureCallCommon等のクリックが通る
 * - InputForm kill/success/cancel/hide、if_s、max、x/y省略の挙動は維持
 * - 長文入力時に文字が縮小される問題を防止（クリップ描画に変更）
 * - Enter確定をDOM inputだけでなくdocument/window側でも補足
 * - max指定時、21字目以降など上限超過分をDOM値・内部値の両方から即時除去
 * - max到達後にIME/キーリピート状態が残ってEnter送信できなくなる問題を修正
 * - スマホ上部補助表示のピクチャ20番がDTextPictureのテキストピクチャでも表示できるよう対応
 * - DTextPictureテキストピクチャは黒背景中央基準で配置し、専用Yオフセットを追加
 * - DTextPictureテキストピクチャ用の専用拡大率を追加
 * - iPad/Androidタブレットでもネイティブ文字入力UIが出るよう判定とfocus処理を強化
 * - iPad Safariでactive扱いのままキーボードが出ないケース向けに、実タップ時の再focusを強化
 * - モバイル環境の未入力・非アクティブ時に「ここをタップして解答」を表示
 * - PCブラウザでゲーム画面クリック後にblurしても、入力欄クリックで再focusできるよう修正
 *
 * 追加指定：
 * w=960;h=50;      入力欄の幅・高さ
 * font=28;         入力文字サイズ
 * placeholder=文字 入力前の薄い表示
 * btn_w=160;btn_h=48; submit判定エリアの幅・高さ
 *
 * スマホ入力UI表示中の上部補助表示：
 * 設定値は、このファイル冒頭付近の MOBILE_OVERLAY_* const を直接編集してください。
 * ピクチャは20番を複製表示し、入力文字は入力フォームと連動します。
 *
 * テストプレイ中は Ctrl を5回押すとPCでもスマホ入力環境扱いに切替。
 * もう一度 Ctrl を5回押すと通常判定に戻ります。
 *
 * ライセンス：
 * このプラグインの利用法に制限はありません。お好きなようにどうぞ。
*/
(function() {
    'use strict';

    //--------------------------------------------------------------------------
    // スマホ入力UI表示中の上部補助表示 設定
    // 数値を直接変更してください。拡大率は100で等倍です。
    //--------------------------------------------------------------------------
    const MOBILE_OVERLAY_BACKGROUND_WIDTH = 520;
    const MOBILE_OVERLAY_BACKGROUND_HEIGHT = 150;
    const MOBILE_OVERLAY_BACKGROUND_Y = 30;
    const MOBILE_OVERLAY_BACKGROUND_OPACITY = 180;
    
    const MOBILE_OVERLAY_PICTURE20_SCALE = 30;
    const MOBILE_OVERLAY_PICTURE_Y = 5;

    const MOBILE_OVERLAY_DTEXT_PICTURE_SCALE = 20;
    const MOBILE_OVERLAY_DTEXT_PICTURE_Y = -10;
    const MOBILE_OVERLAY_DTEXT_MAX_WIDTH_MARGIN = -20;

    // スマホ環境では、フォーム生成時・再表示時などの自動focusで
    // キーボードやキャレットが強制的に戻ることを防ぐ。
    // 入力欄をユーザーがタップした場合のfocusは維持する。
    const MOBILE_DISABLE_AUTO_REFOCUS = true;

    // モバイル環境で、入力欄が未入力かつ非アクティブのときにフォーム部分へ出す案内。
    const MOBILE_INACTIVE_PROMPT_TEXT = 'ここをタップして解答';
    const MOBILE_INACTIVE_PROMPT_OPACITY = 128;

    const MOBILE_OVERLAY_TEXT_SCALE = 60;
    const MOBILE_OVERLAY_TEXT_Y = 112;

    //--------------------------------------------------------------------------
    // 共通マネージャ
    //--------------------------------------------------------------------------
    var MANAGER_NAME = '_111InputFormManager';

    function getManager() {
        if (!window[MANAGER_NAME]) {
            window[MANAGER_NAME] = {};
        }
        return window[MANAGER_NAME];
    }

    function getFormInput() {
        return document.getElementById('_111_input');
    }

    function getFormSubmit() {
        return document.getElementById('_111_submit');
    }

    function removeElement(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function clearWaitMode(it) {
        if (it && it._waitMode === 'input_form') {
            it.setWaitMode('');
        }
    }

    function clearAllWaitModes() {
        try {
            clearWaitMode($gameMap && $gameMap._interpreter);
            clearWaitMode($gameTroop && $gameTroop._interpreter);
            if ($gameMap && $gameMap._commonEvents) {
                $gameMap._commonEvents.forEach(function(ce) {
                    if (ce && ce._interpreter) clearWaitMode(ce._interpreter);
                });
            }
        } catch (e) {
            // ゲーム起動直後など、グローバル未初期化時の保険
        }
    }

    function removeStrayFormElements() {
        removeElement(getFormInput());
        removeElement(getFormSubmit());
    }

    var manager = getManager();
    manager.active = manager.active || null;
    manager.smartphoneDebugForce = !!manager.smartphoneDebugForce;
    manager.clearAllWaitModes = clearAllWaitModes;
    manager.removeStrayFormElements = removeStrayFormElements;
    manager.forceClose = manager.forceClose || function(writeValue, variableId) {
        if (this.active && this.active.finish) {
            this.active.finish(!!writeValue, variableId, true);
        } else {
            var inp = getFormInput();
            if (writeValue && variableId > 0 && inp) {
                $gameVariables.setValue(variableId, inp.value);
            }
            removeStrayFormElements();
            if (window.Input) Input.form_mode = false;
            clearAllWaitModes();
        }
    };
    manager.hide = function(hide) {
        if (this.active && this.active.setHidden) {
            this.active.setHidden(!!hide);
            return;
        }
        var inp = getFormInput();
        var sub = getFormSubmit();
        var d = hide ? 'none' : '';
        if (inp) inp.style.display = d;
        if (sub) sub.style.display = d;
    };
    manager.updateActive = function() {
        if (this.active && this.active.update) {
            this.active.update();
        }
    };

    //--------------------------------------------------------------------------
    // キー入力の抑止
    //--------------------------------------------------------------------------
    // キーボード入力は透明DOM inputで受ける。
    // TouchInputは止めない。ここを止めるとPictureCallCommon等のクリックが死ぬ。
    Input.form_mode = false;

    if (!Input._111InputFormKeyPatched) {
        Input._111InputFormKeyPatched = true;

        var _Input_onKeyDown = Input._onKeyDown;
        Input._onKeyDown = function(event) {
            if (Input.form_mode) return;
            _Input_onKeyDown.call(this, event);
        };

        var _Input_onKeyUp = Input._onKeyUp;
        Input._onKeyUp = function(event) {
            if (Input.form_mode) return;
            _Input_onKeyUp.call(this, event);
        };
    }

    //--------------------------------------------------------------------------
    // Scene update hook
    //--------------------------------------------------------------------------
    if (window.Scene_Base && !Scene_Base.prototype._111InputFormEmbeddedUpdatePatched) {
        Scene_Base.prototype._111InputFormEmbeddedUpdatePatched = true;
        var _Scene_Base_update = Scene_Base.prototype.update;
        Scene_Base.prototype.update = function() {
            _Scene_Base_update.call(this);
            var m = getManager();
            if (m && m.updateActive) m.updateActive();
        };
    }

    //--------------------------------------------------------------------------
    // 入力終わるまで次のイベントコマンドを読み込まない
    //--------------------------------------------------------------------------
    if (!Game_Interpreter.prototype._111InputFormWaitPatched) {
        Game_Interpreter.prototype._111InputFormWaitPatched = true;
        var _Game_Interpreter_updateWaitMode = Game_Interpreter.prototype.updateWaitMode;
        Game_Interpreter.prototype.updateWaitMode = function() {
            if (this._waitMode === 'input_form') return true;
            return _Game_Interpreter_updateWaitMode.call(this);
        };
    }

    //--------------------------------------------------------------------------
    // ユーティリティ
    //--------------------------------------------------------------------------
    function trimText(value) {
        return String(value == null ? '' : value).replace(/^\s+|\s+$/g, '');
    }

    function argHash(text) {
        var result = {};
        String(text || '').split(';').forEach(function(str) {
            str = trimText(str);
            if (!str) return;
            var index = str.indexOf('=');
            if (index < 0) return;
            var prop = trimText(str.slice(0, index)).toLowerCase();
            var value = trimText(str.slice(index + 1));
            if (prop) result[prop] = value;
        });
        return result;
    }

    function hasOwn(obj, key) {
        return Object.prototype.hasOwnProperty.call(obj, key);
    }

    function numberOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        var n = Number(value);
        return isNaN(n) ? null : n;
    }

    function numberOrDefault(value, defaultValue) {
        var n = numberOrNull(value);
        return n === null ? defaultValue : n;
    }

    function boolText(value, defaultValue) {
        if (value === null || value === undefined || value === '') return !!defaultValue;
        var s = String(value).toLowerCase();
        if (s === 'on' || s === 'true' || s === '1' || s === 'yes') return true;
        if (s === 'off' || s === 'false' || s === '0' || s === 'no') return false;
        return !!defaultValue;
    }

    function graphicsWidth() {
        return Math.max(1, Number((window.Graphics && (Graphics.width || Graphics.boxWidth)) || 1280));
    }

    function graphicsHeight() {
        return Math.max(1, Number((window.Graphics && (Graphics.height || Graphics.boxHeight)) || 720));
    }

    function defaultX() {
        // 旧CSS版で x= 省略時に left:5% を使っていた環境に寄せる。
        return Math.round(graphicsWidth() * 0.05);
    }

    function defaultWidth(x) {
        // 旧CSS版の横長入力欄に近い 90% 幅。
        var left = Number(x || 0);
        return Math.max(120, Math.round(graphicsWidth() - left * 2));
    }

    function defaultHeight() {
        // 旧CSS版の height:10% に相当。
        return Math.max(40, Math.round(graphicsHeight() * 0.10));
    }

    function defaultFontSize() {
        // 旧CSS版の calc(6px + 64 * (100vw - 100px) / 1920) に近い値。
        var size = 6 + 64 * (graphicsWidth() - 100) / 1920;
        return Math.max(16, Math.round(size));
    }

    function canvasRect() {
        var canvas = (window.Graphics && Graphics._canvas) ||
                     document.querySelector('#UpperCanvas') ||
                     document.querySelector('#GameCanvas') ||
                     document.querySelector('canvas');
        if (canvas && canvas.getBoundingClientRect) {
            return canvas.getBoundingClientRect();
        }
        return { left: 0, top: 0, width: graphicsWidth(), height: graphicsHeight() };
    }

    function addEvent(target, type, handler, options) {
        if (!target || !target.addEventListener) return null;
        target.addEventListener(type, handler, options || false);
        return { target: target, type: type, handler: handler, options: options || false };
    }

    function removeRegisteredEvents(events) {
        events.forEach(function(e) {
            if (e && e.target && e.target.removeEventListener) {
                e.target.removeEventListener(e.type, e.handler, e.options);
            }
        });
        events.length = 0;
    }

    function safeFocus(input, forceRefocus) {
        if (!input) return;

        // iPad Safariでは、見た目上キーボードが閉じていてもDOM上はactiveElementのまま残り、
        // 次のタップで focus() が空振りしてソフトウェアキーボードが出ないことがある。
        // 実タップイベント中だけ forceRefocus=true で一度blurしてからfocusし直す。
        if (document.activeElement === input) {
            if (!forceRefocus) return;
            try { input.blur(); } catch (e0) {}
        }

        try { input.readOnly = false; } catch (e1) {}
        try { input.disabled = false; } catch (e2) {}
        try {
            input.focus({ preventScroll: true });
        } catch (e) {
            try { input.focus(); } catch (e3) {}
        }
        try {
            var len = String(input.value || '').length;
            if (typeof input.setSelectionRange === 'function') input.setSelectionRange(len, len);
        } catch (e4) {}
    }

    function safeBlur(input) {
        if (!input || document.activeElement !== input) return;
        try { input.blur(); } catch (e) {}
    }

    function getScene() {
        return window.SceneManager && SceneManager._scene ? SceneManager._scene : null;
    }

    function addSpriteToScene(sprite) {
        var scene = getScene();
        if (!scene || !sprite) return;
        if (sprite.parent !== scene) {
            if (sprite.parent && sprite.parent.removeChild) sprite.parent.removeChild(sprite);
            scene.addChild(sprite);
        }
    }

    function removeSprite(sprite) {
        if (sprite && sprite.parent && sprite.parent.removeChild) {
            sprite.parent.removeChild(sprite);
        }
    }

    function measureText(bitmap, text) {
        if (!bitmap) return 0;
        try {
            if (typeof bitmap.measureTextWidth === 'function') {
                return bitmap.measureTextWidth(String(text || ''));
            }
        } catch (e) {}
        return String(text || '').length * 24;
    }

    function bitmapFontName(bitmap) {
        if (!bitmap) return '28px sans-serif';
        try {
            if (typeof bitmap._makeFontNameText === 'function') {
                return bitmap._makeFontNameText();
            }
        } catch (e) {}
        var face = bitmap.fontFace || 'sans-serif';
        var size = Math.max(1, Math.round(Number(bitmap.fontSize || 28)));
        return size + 'px ' + face;
    }

    function bitmapPaintAlpha(bitmap) {
        if (!bitmap) return 1;
        var opacity = Number(bitmap.paintOpacity == null ? 255 : bitmap.paintOpacity);
        if (isNaN(opacity)) opacity = 255;
        return Math.max(0, Math.min(1, opacity / 255));
    }

    function drawTextClippedNoScale(bitmap, text, x, y, width, lineHeight, align, scrollX) {
        if (!bitmap) return;
        text = String(text || '');
        var ctx = bitmap.context || bitmap._context;
        if (!ctx) {
            // contextが取れない環境では従来APIに戻す。ただし幅不足時の縮小を避けるため、必要幅を渡す。
            var fallbackWidth = Math.max(Number(width || 0), measureText(bitmap, text) + 8);
            bitmap.drawText(text, x, y, fallbackWidth, lineHeight, align || 'left');
            return;
        }

        var drawW = Math.max(1, Number(width || 1));
        var drawH = Math.max(1, Number(lineHeight || bitmap.fontSize || 28));
        var measured = measureText(bitmap, text);
        var sx = Math.max(0, Number(scrollX || 0));
        var dx = Number(x || 0) - sx;
        var textAlign = 'left';

        if (sx <= 0) {
            if (align === 'center' && measured < drawW) {
                dx = Number(x || 0) + Math.round((drawW - measured) / 2);
            } else if (align === 'right' && measured < drawW) {
                dx = Number(x || 0) + Math.round(drawW - measured);
            }
        }

        var fontSize = Math.max(1, Number(bitmap.fontSize || 28));
        // RPGツクールMVのBitmap.drawTextに近いベースライン。
        var ty = Math.round(Number(y || 0) + drawH / 2 + fontSize * 0.35);

        ctx.save();
        ctx.beginPath();
        ctx.rect(Number(x || 0), Number(y || 0), drawW, drawH);
        ctx.clip();
        ctx.font = bitmapFontName(bitmap);
        ctx.textAlign = textAlign;
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = bitmapPaintAlpha(bitmap);

        var outlineWidth = Math.max(0, Number(bitmap.outlineWidth || 0));
        if (outlineWidth > 0) {
            ctx.strokeStyle = bitmap.outlineColor || '#000000';
            ctx.lineWidth = outlineWidth;
            try { ctx.strokeText(text, dx, ty); } catch (e) {}
        }
        ctx.fillStyle = bitmap.textColor || '#ffffff';
        try { ctx.fillText(text, dx, ty); } catch (e2) {}
        ctx.restore();
        markBitmapDirty(bitmap);
    }

    function setBitmapFont(bitmap, fontSize, fontFace, textColor, outlineColor, outlineWidth) {
        if (!bitmap) return;
        bitmap.fontFace = fontFace || (window.$gameSystem && $gameSystem.mainFontFace ? $gameSystem.mainFontFace() : 'GameFont');
        bitmap.fontSize = Math.max(1, Math.round(Number(fontSize || 28)));
        bitmap.textColor = textColor || '#ffffff';
        bitmap.outlineColor = outlineColor || '#000000';
        bitmap.outlineWidth = Math.max(0, Math.round(Number(outlineWidth || 4)));
    }

    function markBitmapDirty(bitmap) {
        if (!bitmap) return;
        try { if (typeof bitmap._setDirty === 'function') bitmap._setDirty(); } catch (e) {}
        try { if (bitmap._baseTexture) bitmap._baseTexture.update(); } catch (e2) {}
    }

    function drawRoundedFill(bitmap, x, y, width, height, radius, color, alpha) {
        if (!bitmap) return;
        var ctx = bitmap.context || bitmap._context;
        var w = Math.max(1, Number(width || 1));
        var h = Math.max(1, Number(height || 1));
        var r = Math.max(0, Math.min(Number(radius || 0), w / 2, h / 2));
        var a = Math.max(0, Math.min(1, Number(alpha == null ? 1 : alpha)));
        if (!ctx) {
            bitmap.paintOpacity = Math.round(255 * a);
            bitmap.fillRect(x, y, w, h, color || '#000000');
            bitmap.paintOpacity = 255;
            markBitmapDirty(bitmap);
            return;
        }
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = color || '#000000';
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        markBitmapDirty(bitmap);
    }

    function colorWithOpacity(color, opacity) {
        var op = Math.max(0, Math.min(1, Number(opacity || 0)));
        if (String(color || '').indexOf('rgba') === 0) return color;
        if (String(color || '').indexOf('rgb(') === 0) {
            return String(color).replace(/^rgb\((.+)\)$/i, 'rgba($1,' + op + ')');
        }
        return color;
    }

    function callBooleanProvider(provider, methodName) {
        try {
            if (provider && typeof provider[methodName] === 'function') {
                return !!provider[methodName]();
            }
        } catch (e) {}
        return false;
    }

    function isPlaytestForSmartphoneDebug() {
        try {
            return !!(window.$gameTemp && typeof $gameTemp.isPlaytest === 'function' && $gameTemp.isPlaytest());
        } catch (e) {}
        return false;
    }

    function isSmartphoneDebugForced() {
        return !!(manager && manager.smartphoneDebugForce && isPlaytestForSmartphoneDebug());
    }

    function applySmartphoneDebugForce(value) {
        manager.smartphoneDebugForce = !!value;
        try {
            console.log('InputForm: smartphone debug mode ' + (manager.smartphoneDebugForce ? 'ON' : 'OFF'));
        } catch (e) {}
        if (manager.active && manager.active.updateSmartphoneMode) {
            manager.active.updateSmartphoneMode(true);
        }
    }

    function setupSmartphoneDebugToggle() {
        if (typeof document === 'undefined') return;
        if (manager._111SmartphoneDebugTogglePatched) return;
        manager._111SmartphoneDebugTogglePatched = true;

        var ctrlCount = 0;
        var ctrlDown = false;
        var lastCtrlTime = 0;
        var resetMs = 3000;

        var isCtrlEvent = function(e) {
            return !!(e && (e.key === 'Control' || e.keyCode === 17 || e.which === 17));
        };

        document.addEventListener('keydown', function(e) {
            if (!isPlaytestForSmartphoneDebug()) return;
            if (!isCtrlEvent(e)) return;
            if (e.repeat || ctrlDown) return;
            ctrlDown = true;

            var now = Date.now ? Date.now() : new Date().getTime();
            if (now - lastCtrlTime > resetMs) ctrlCount = 0;
            lastCtrlTime = now;
            ctrlCount += 1;

            if (ctrlCount >= 5) {
                ctrlCount = 0;
                applySmartphoneDebugForce(!manager.smartphoneDebugForce);
            }
        }, true);

        document.addEventListener('keyup', function(e) {
            if (isCtrlEvent(e)) ctrlDown = false;
        }, true);

        window.addEventListener('blur', function() {
            ctrlDown = false;
        }, false);
    }

    setupSmartphoneDebugToggle();

    function navigatorUserAgentText() {
        try {
            return String((window.navigator && window.navigator.userAgent) || '');
        } catch (e) {}
        return '';
    }

    function navigatorPlatformText() {
        try {
            return String((window.navigator && window.navigator.platform) || '');
        } catch (e) {}
        return '';
    }

    function navigatorMaxTouchPoints() {
        try {
            var nav = window.navigator || {};
            return Number(nav.maxTouchPoints || nav.msMaxTouchPoints || 0);
        } catch (e) {}
        return 0;
    }

    function hasTouchInputCapability() {
        if (navigatorMaxTouchPoints() > 0) return true;
        try {
            if ('ontouchstart' in window) return true;
        } catch (e) {}
        return false;
    }

    function matchesMediaQuery(query) {
        try {
            return !!(window.matchMedia && window.matchMedia(query).matches);
        } catch (e) {}
        return false;
    }

    function isCoarsePointerEnvironment() {
        // タブレットはUAがPC寄りになることがあるため、ポインタ特性でも拾う。
        return matchesMediaQuery('(pointer: coarse)') || matchesMediaQuery('(any-pointer: coarse)');
    }

    function isAppleTouchTabletEnvironment() {
        var ua = navigatorUserAgentText();
        var lowerUa = ua.toLowerCase();
        var platform = navigatorPlatformText().toLowerCase();
        var touchPoints = navigatorMaxTouchPoints();

        if (/ipad/i.test(ua)) return true;
        // iPadOS 13以降のSafariは、デスクトップ表示時に userAgent が Macintosh になる。
        // platform=MacIntel または Macintosh UA かつ複数タッチ対応ならiPad系として扱う。
        if ((platform === 'macintel' || lowerUa.indexOf('macintosh') >= 0) && touchPoints > 1) return true;
        return false;
    }

    function isAppleTouchInputEnvironment() {
        var ua = navigatorUserAgentText();
        if (/iphone|ipad|ipod/i.test(ua)) return true;
        return isAppleTouchTabletEnvironment();
    }

    function isSafariBrowserEnvironment() {
        var ua = navigatorUserAgentText();
        if (!/safari/i.test(ua)) return false;
        // iOS/iPadOS上のChrome/Edge/Firefox等はSafari文字列も含むため除外。
        if (/crios|fxios|edgios|opr|opera|chrome|chromium|android/i.test(ua)) return false;
        return true;
    }

    function shouldForceNativeKeyboardRefocus() {
        return !!(isAppleTouchInputEnvironment() && isSafariBrowserEnvironment());
    }

    function isTabletInputEnvironmentByNavigator() {
        var ua = navigatorUserAgentText();
        var lowerUa = ua.toLowerCase();
        var platform = navigatorPlatformText().toLowerCase();
        var touchPoints = navigatorMaxTouchPoints();

        if (isAppleTouchTabletEnvironment()) return true;

        // 典型的なタブレットUA。Androidタブレットは Mobile が付かないことが多い。
        if (/ipad|tablet|playbook|silk|kindle|kftt|kfot|kfjwa|kfjwi|kfapwa|kfapwi|kfthwa|kfthwi|kfauwi|kfmawi|kfgiwi|kfsowi/i.test(ua)) return true;
        if (/android/i.test(ua) && !/mobile/i.test(ua)) return true;

        return false;
    }

    function isTouchInputEnvironmentByNavigator() {
        var ua = navigatorUserAgentText();

        try {
            if (window.navigator && window.navigator.userAgentData && window.navigator.userAgentData.mobile) return true;
        } catch (e) {}
        if (/iphone|ipod|ipad|android|windows phone|mobile|tablet|playbook|silk|kindle/i.test(ua)) return true;
        if (isTabletInputEnvironmentByNavigator()) return true;

        return false;
    }

    function isSmartphoneInputEnvironment() {
        if (isSmartphoneDebugForced()) return true;
        var providers = [window.BootManager, window.ProgressManager, window.KanjiGogoPlaytest, window.Utils];
        var methods = [
            'isIosApp',
            'isAndroidApp',
            'isSmartphoneApp',
            'isCordovaApp',
            'isMobileDevice',
            'isTabletDevice',
            'isTablet',
            'isMobileSafari'
        ];
        for (var i = 0; i < providers.length; i++) {
            for (var j = 0; j < methods.length; j++) {
                if (callBooleanProvider(providers[i], methods[j])) return true;
            }
        }
        try {
            if (window.Utils && typeof Utils.isMobileDevice === 'function' && Utils.isMobileDevice()) return true;
        } catch (e2) {}

        // RPGツクールMV標準や独自BootManagerがスマホ判定できない環境向け。
        // iPadOSのデスクトップUA、Androidタブレット、Kindle系なども
        // 透明DOM inputをタップ可能にして、ネイティブフォーム/キーボードを出す。
        if (hasTouchInputCapability() && isTouchInputEnvironmentByNavigator()) return true;
        // 一部のiPad/タブレットWebViewはUAがPC寄りでも、coarse pointerだけは取れる。
        if (hasTouchInputCapability() && isCoarsePointerEnvironment()) return true;

        return false;
    }

    function syncDomInputPosition(input, root, width, height, allowPointer) {
        if (!input || typeof document === 'undefined') return;
        var rect = canvasRect();
        var gameW = graphicsWidth();
        var gameH = graphicsHeight();
        var scaleX = Number(rect.width || gameW) / gameW;
        var scaleY = Number(rect.height || gameH) / gameH;

        var gameLeft = root ? Number(root.x || 0) : 0;
        var gameTop = root ? Number(root.y || 0) : 0;
        var worldScaleX = 1.0;
        var worldScaleY = 1.0;
        if (root && root.getGlobalPosition) {
            try {
                var pos = root.getGlobalPosition();
                gameLeft = Number(pos.x || 0);
                gameTop = Number(pos.y || 0);
                var wt = root.worldTransform;
                if (wt) {
                    worldScaleX = Math.sqrt(Number(wt.a || 0) * Number(wt.a || 0) + Number(wt.b || 0) * Number(wt.b || 0)) || 1.0;
                    worldScaleY = Math.sqrt(Number(wt.c || 0) * Number(wt.c || 0) + Number(wt.d || 0) * Number(wt.d || 0)) || 1.0;
                }
            } catch (e) {}
        }

        input.style.left = Math.round(Number(rect.left || 0) + gameLeft * scaleX) + 'px';
        input.style.top = Math.round(Number(rect.top || 0) + gameTop * scaleY) + 'px';
        input.style.width = Math.max(1, Math.round(Number(width || 1) * worldScaleX * scaleX)) + 'px';
        input.style.height = Math.max(1, Math.round(Number(height || 1) * worldScaleY * scaleY)) + 'px';
        input.style.pointerEvents = allowPointer ? 'auto' : 'none';
    }

    function eventToGamePoint(event) {
        if (!event) return null;
        var src = event;
        if (event.changedTouches && event.changedTouches.length > 0) {
            src = event.changedTouches[0];
        } else if (event.touches && event.touches.length > 0) {
            src = event.touches[0];
        }
        if (src.clientX === undefined || src.clientY === undefined) return null;
        var rect = canvasRect();
        var rectW = Math.max(1, Number(rect.width || graphicsWidth()));
        var rectH = Math.max(1, Number(rect.height || graphicsHeight()));
        return {
            x: (Number(src.clientX || 0) - Number(rect.left || 0)) * graphicsWidth() / rectW,
            y: (Number(src.clientY || 0) - Number(rect.top || 0)) * graphicsHeight() / rectH
        };
    }

    function pointInsideRootRect(root, localX, localY, width, height, x, y) {
        if (!root) return false;
        var lx = Number(x || 0) - Number(root.x || 0);
        var ly = Number(y || 0) - Number(root.y || 0);
        if (root.worldTransform && window.PIXI && PIXI.Point) {
            try {
                var p = root.worldTransform.applyInverse(new PIXI.Point(Number(x || 0), Number(y || 0)), new PIXI.Point());
                lx = Number(p.x || 0);
                ly = Number(p.y || 0);
            } catch (e) {}
        }
        return lx >= Number(localX || 0) && ly >= Number(localY || 0) &&
               lx < Number(localX || 0) + Number(width || 0) &&
               ly < Number(localY || 0) + Number(height || 0);
    }

    function getPictureSpriteById(pictureId) {
        var id = Math.max(1, Math.round(Number(pictureId || 0)));
        try {
            var scene = getScene();
            var spriteset = scene && scene._spriteset ? scene._spriteset : null;
            var container = spriteset && spriteset._pictureContainer ? spriteset._pictureContainer : null;
            var children = container && container.children ? container.children : [];
            for (var i = 0; i < children.length; i++) {
                var sprite = children[i];
                if (sprite && Number(sprite._pictureId || 0) === id) {
                    return sprite;
                }
            }
        } catch (e) {}
        return null;
    }

    function getPictureName(picture) {
        if (!picture) return '';
        try {
            if (typeof picture.name === 'function') return String(picture.name() || '');
            return String(picture._name || '');
        } catch (e) {
            return '';
        }
    }

    function isDTextPicture(picture) {
        // DTextPicture.js は文字列ピクチャ表示時、Game_Picture.dTextInfo に
        // 描画情報を保持し、_name には一時的な日時文字列を入れる。
        // その _name を通常画像ファイル名として読むと失敗するため、
        // dTextInfo がある場合は現在表示中の Sprite_Picture.bitmap を優先する。
        return !!(picture && picture.dTextInfo);
    }

    function isDTextPictureById(pictureId) {
        var id = Math.max(1, Math.round(Number(pictureId || 0)));
        try {
            var picture = window.$gameScreen && $gameScreen.picture ? $gameScreen.picture(id) : null;
            return isDTextPicture(picture);
        } catch (e) {
            return false;
        }
    }

    function getPictureBitmapById(pictureId) {
        var id = Math.max(1, Math.round(Number(pictureId || 0)));
        var picture = null;
        var name = '';
        var sprite = null;

        try {
            picture = window.$gameScreen && $gameScreen.picture ? $gameScreen.picture(id) : null;
            name = getPictureName(picture);
        } catch (e) {
            picture = null;
            name = '';
        }

        sprite = getPictureSpriteById(id);

        if (isDTextPicture(picture)) {
            if (sprite && sprite.bitmap) return sprite.bitmap;
            return null;
        }

        if (name && window.ImageManager && typeof ImageManager.loadPicture === 'function') {
            return ImageManager.loadPicture(name);
        }

        // ピクチャ名が取得できないケースの保険：現在のSprite_Pictureからbitmapを拾う。
        if (sprite && sprite.bitmap) return sprite.bitmap;
        return null;
    }

    //--------------------------------------------------------------------------
    // Game_Interpreter - register plugin commands
    //--------------------------------------------------------------------------
    var _Game_Interpreter_pluginCommand = Game_Interpreter.prototype.pluginCommand;
    Game_Interpreter.prototype.pluginCommand = function(command, args) {
        args = args || [];

        // ForceClose系サブコマンドは、フォーム作成として扱わない。
        // ForceCloseプラグインが前後どちらに読み込まれても誤生成を防ぐ。
        if (command === 'InputForm') {
            var sub = String(args[0] || '').toLowerCase();
            if (sub === 'kill' || sub === 'success' || sub === 'cancel' || sub === 'hide') {
                _Game_Interpreter_pluginCommand.call(this, command, args);
                return;
            }
        }

        _Game_Interpreter_pluginCommand.call(this, command, args);

        if (command !== 'InputForm') return;

        var argText = args.join(' ');
        var hash = argHash(argText);

        var raw_x = hasOwn(hash, 'x') ? numberOrNull(hash.x) : null;
        var raw_y = hasOwn(hash, 'y') ? numberOrNull(hash.y) : null;
        var variables_id = numberOrDefault(hash.v, 0);
        var max_count = hasOwn(hash, 'max') ? hash.max : null;
        var max_limit = null;
        if (max_count !== null && max_count !== '') {
            max_limit = Math.max(0, Number(max_count || 0));
            if (isNaN(max_limit)) max_limit = null;
        }
        var if_switch_id = numberOrDefault(hash.if_s, 0);
        var defaultBaseX = raw_x === null ? defaultX() : raw_x;
        var width = numberOrDefault(hash.w != null ? hash.w : hash.width, defaultWidth(defaultBaseX));
        var height = numberOrDefault(hash.h != null ? hash.h : hash.height, defaultHeight());
        var target_x = raw_x === null ? Math.round((graphicsWidth() - width) / 2) : raw_x;
        var target_y = raw_y === null ? 0 : raw_y;
        var fontSize = numberOrDefault(hash.font, defaultFontSize());
        var button_x = numberOrDefault(hash.btn_x, 0);
        var button_y = numberOrDefault(hash.btn_y, height);
        var button_w = numberOrDefault(hash.btn_w, Math.max(120, Math.round(width * 0.18)));
        var button_h = numberOrDefault(hash.btn_h, height);
        var enableSubmitHit = boolText(hash.submit, true);
        var placeholder = hasOwn(hash, 'placeholder') ? String(hash.placeholder || '') : '';
        var mobileInactivePrompt = String(MOBILE_INACTIVE_PROMPT_TEXT || '');
        var mobileInactivePromptOpacity = Math.max(0, Math.min(255, Math.round(Number(MOBILE_INACTIVE_PROMPT_OPACITY == null ? 128 : MOBILE_INACTIVE_PROMPT_OPACITY))));

        var mobileOverlayEnabled = true;
        var mobilePictureId = 20;
        var mobileBgW = Math.max(1, Math.round(Number(MOBILE_OVERLAY_BACKGROUND_WIDTH || graphicsWidth())));
        var mobileBgH = Math.max(1, Math.round(Number(MOBILE_OVERLAY_BACKGROUND_HEIGHT || 1)));
        var mobileBgY = Math.round(Number(MOBILE_OVERLAY_BACKGROUND_Y || 0));
        var mobileBgOpacity = Math.max(0, Math.min(255, Math.round(Number(MOBILE_OVERLAY_BACKGROUND_OPACITY == null ? 180 : MOBILE_OVERLAY_BACKGROUND_OPACITY))));
        var mobilePictureScale = Math.max(1, Number(MOBILE_OVERLAY_PICTURE20_SCALE || 100));
        var mobileDTextPictureScale = Math.max(1, Number(MOBILE_OVERLAY_DTEXT_PICTURE_SCALE || 100));
        var mobilePictureY = Math.round(Number(MOBILE_OVERLAY_PICTURE_Y || 0));
        var mobileDTextPictureY = Math.round(Number(MOBILE_OVERLAY_DTEXT_PICTURE_Y || 0));
        var mobileDTextMaxWidthMargin = Math.max(0, Math.round(Number(MOBILE_OVERLAY_DTEXT_MAX_WIDTH_MARGIN || 0)));
        var mobileTextScale = Math.max(1, Number(MOBILE_OVERLAY_TEXT_SCALE || 100));
        var mobileTextY = Math.round(Number(MOBILE_OVERLAY_TEXT_Y || 0));

        if (variables_id <= 0) {
            console.warn('InputForm: v= の変数IDが不正です。', argText);
            return;
        }

        // 既存フォームが残っている場合は、安全に閉じてから作り直す。
        if (manager.active && manager.active.finish) {
            manager.active.finish(false, 0, true);
        } else {
            removeStrayFormElements();
        }

        var interpreter = this;
        var gui = {
            input: null,
            root: null,
            bgSprite: null,
            textSprite: null,
            mobileOverlayRoot: null,
            mobileOverlayBgSprite: null,
            mobileOverlayPictureSprite: null,
            mobileOverlayTextSprite: null,
            mobileOverlayVisible: false,
            lastMobileOverlayText: null,
            lastMobilePictureBitmap: null,
            mobileViewportBaseHeight: 0,
            mobileKeyboardEverShrunk: false,
            closed: false,
            hidden: false,
            events: [],
            switchArmed: true,
            smartphoneNativeInput: false,
            composing: false,
            ignoreEnterUntilKeyup: false,
            focused: false,
            caretBlink: 0,
            lastText: null,
            lastScene: null,

            init: function() {
                this.createSprites();
                this.createDomInput();
                this.start();
                this.screenAdjust();
                this.refresh();

                // PCでは初期focusでそのまま入力できる。
                // スマホ環境では自動focusを抑止し、ユーザー操作時のfocusに限定する。
                this.autoRefocus();
                var self = this;
                setTimeout(function(){ if (!self.closed) self.autoRefocus(); }, 0);
                setTimeout(function(){ if (!self.closed) self.autoRefocus(); }, 80);
            },

            createSprites: function() {
                this.root = new Sprite();
                this.root.x = Math.round(target_x);
                this.root.y = Math.round(target_y);
                this.root.visible = true;
                addSpriteToScene(this.root);
                this.lastScene = getScene();

                this.bgSprite = new Sprite(new Bitmap(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))));
                this.root.addChild(this.bgSprite);

                this.textSprite = new Sprite(new Bitmap(Math.max(1, Math.round(width)), Math.max(1, Math.round(height))));
                this.root.addChild(this.textSprite);

                this.createMobileOverlaySprites();
            },

            createMobileOverlaySprites: function() {
                if (!mobileOverlayEnabled) return;

                this.mobileOverlayRoot = new Sprite();
                this.mobileOverlayRoot.visible = false;
                addSpriteToScene(this.mobileOverlayRoot);

                this.mobileOverlayBgSprite = new Sprite(new Bitmap(mobileBgW, mobileBgH));
                this.mobileOverlayRoot.addChild(this.mobileOverlayBgSprite);

                this.mobileOverlayPictureSprite = new Sprite();
                this.mobileOverlayPictureSprite.anchor.x = 0.5;
                this.mobileOverlayPictureSprite.anchor.y = 0;
                this.mobileOverlayRoot.addChild(this.mobileOverlayPictureSprite);

                var textFontSize = Math.max(1, Math.round(fontSize * mobileTextScale / 100));
                var textBitmapH = Math.max(1, textFontSize + 16);
                this.mobileOverlayTextSprite = new Sprite(new Bitmap(mobileBgW, textBitmapH));
                this.mobileOverlayRoot.addChild(this.mobileOverlayTextSprite);

                this.layoutMobileOverlay();
                this.drawMobileOverlayBackground();
            },

            createDomInput: function() {
                if (typeof document === 'undefined') return;
                removeStrayFormElements();
                this.input = document.createElement('input');
                this.input.setAttribute('type', 'text');
                this.input.setAttribute('id', '_111_input');
                this.input.setAttribute('autocomplete', 'off');
                this.input.setAttribute('autocorrect', 'off');
                this.input.setAttribute('autocapitalize', 'off');
                this.input.setAttribute('spellcheck', 'false');
                this.input.setAttribute('inputmode', 'text');
                this.input.setAttribute('enterkeyhint', 'done');
                this.input.setAttribute('data-111-embedded', 'true');
                if (max_limit !== null) this.input.setAttribute('maxlength', String(max_limit));

                this.smartphoneNativeInput = isSmartphoneInputEnvironment();
                this.mobileViewportBaseHeight = this.currentVisualViewportHeight();
                this.input.style.position = 'fixed';
                this.input.style.opacity = this.smartphoneNativeInput ? '0.01' : '0';
                this.input.style.pointerEvents = this.smartphoneNativeInput ? 'auto' : 'none';
                this.input.style.touchAction = 'manipulation';
                this.input.style.webkitUserSelect = 'text';
                this.input.style.userSelect = 'text';
                this.input.style.border = '0';
                this.input.style.outline = '0';
                this.input.style.background = 'transparent';
                this.input.style.color = 'transparent';
                this.input.style.caretColor = 'transparent';
                this.input.style.zIndex = '1000';
                this.input.style.fontSize = Math.max(16, Math.round(fontSize)) + 'px';
                this.input.style.fontFamily = 'sans-serif';
                this.input.style.padding = '0';
                this.input.style.margin = '0';
                this.input.style.webkitAppearance = 'none';
                this.input.style.appearance = 'none';
                this.input.style.cursor = 'text';
                this.input.readOnly = false;
                this.input.disabled = false;

                document.body.appendChild(this.input);
                if (this.smartphoneNativeInput) {
                    // iPad Safariで前回のactive状態が残るケースを避け、最初のタップを確実にfocus遷移にする。
                    safeBlur(this.input);
                    this.focused = false;
                }
                this.bindDomEvents();
            },

            updateSmartphoneMode: function(forceRefresh) {
                var next = isSmartphoneInputEnvironment();
                if (!forceRefresh && next === this.smartphoneNativeInput) return;

                this.smartphoneNativeInput = next;
                if (this.input) {
                    this.input.style.opacity = this.smartphoneNativeInput ? '0.01' : '0';
                    this.input.style.pointerEvents = this.smartphoneNativeInput && !this.hidden ? 'auto' : 'none';
                }
                this.screenAdjust();
                if (!this.smartphoneNativeInput) this.setMobileOverlayVisible(false);
                else this.updateMobileOverlayVisibility();
            },

            layoutMobileOverlay: function() {
                if (!this.mobileOverlayRoot) return;
                var bgX = Math.round((graphicsWidth() - mobileBgW) / 2);
                var bgY = Math.round(mobileBgY);

                if (this.mobileOverlayBgSprite) {
                    this.mobileOverlayBgSprite.x = bgX;
                    this.mobileOverlayBgSprite.y = bgY;
                }

                if (this.mobileOverlayPictureSprite) {
                    var isDText = isDTextPictureById(mobilePictureId);
                    this.mobileOverlayPictureSprite.x = Math.round(graphicsWidth() / 2);
                    this.mobileOverlayPictureSprite.anchor.x = 0.5;
                    this.mobileOverlayPictureSprite.anchor.y = isDText ? 0.5 : 0;
                    this.mobileOverlayPictureSprite.y = isDText
                        ? Math.round(bgY + mobileBgH / 2 + mobileDTextPictureY)
                        : Math.round(bgY + mobilePictureY);
                    this.applyMobileOverlayPictureScale(isDText);
                }

                if (this.mobileOverlayTextSprite) {
                    this.mobileOverlayTextSprite.x = bgX;
                    this.mobileOverlayTextSprite.y = Math.round(bgY + mobileTextY);
                }
            },

            applyMobileOverlayPictureScale: function(isDText) {
                if (!this.mobileOverlayPictureSprite) return;

                var picScale = (isDText ? mobileDTextPictureScale : mobilePictureScale) / 100;
                var bitmap = this.mobileOverlayPictureSprite.bitmap;

                if (isDText && bitmap && bitmap.width > 0) {
                    var maxWidth = Math.max(1, mobileBgW - mobileDTextMaxWidthMargin);
                    var scaledWidth = bitmap.width * picScale;

                    if (scaledWidth > maxWidth) {
                        picScale *= maxWidth / scaledWidth;
                    }
                }

                this.mobileOverlayPictureSprite.scale.x = picScale;
                this.mobileOverlayPictureSprite.scale.y = picScale;
            },

            drawMobileOverlayBackground: function() {
                if (!this.mobileOverlayBgSprite || !this.mobileOverlayBgSprite.bitmap) return;
                var b = this.mobileOverlayBgSprite.bitmap;
                b.clear();
                drawRoundedFill(b, 0, 0, b.width, b.height, Math.min(12, Math.floor(b.height / 2)), '#000000', mobileBgOpacity / 255);
            },

            updateMobileOverlayPicture: function() {
                if (!this.mobileOverlayPictureSprite) return;
                var bitmap = getPictureBitmapById(mobilePictureId);
                if (bitmap !== this.lastMobilePictureBitmap) {
                    this.mobileOverlayPictureSprite.bitmap = bitmap;
                    this.lastMobilePictureBitmap = bitmap;
                }
                this.applyMobileOverlayPictureScale(isDTextPictureById(mobilePictureId));
                this.mobileOverlayPictureSprite.visible = !!bitmap;
            },

            currentVisualViewportHeight: function() {
                try {
                    if (window.visualViewport && visualViewport.height) {
                        return Number(visualViewport.height || 0);
                    }
                } catch (e) {}
                try { return Number(window.innerHeight || 0); } catch (e2) {}
                return 0;
            },

            updateMobileViewportBase: function() {
                var h = this.currentVisualViewportHeight();
                if (h > 0 && h > Number(this.mobileViewportBaseHeight || 0)) {
                    this.mobileViewportBaseHeight = h;
                }
            },

            isMobileKeyboardOverlayActive: function() {
                if (!this.focused) return false;
                if (isSmartphoneDebugForced()) return true;
                if (!window.visualViewport) return true;

                this.updateMobileViewportBase();
                var currentH = this.currentVisualViewportHeight();
                var baseH = Number(this.mobileViewportBaseHeight || 0);
                if (currentH <= 0 || baseH <= 0) return true;

                var threshold = Math.max(40, baseH * 0.08);
                var shrunk = currentH < baseH - threshold;
                if (shrunk) this.mobileKeyboardEverShrunk = true;

                // 一度でもviewport縮小を確認できた環境では、UIを閉じて高さが戻ったら上部表示も消す。
                if (this.mobileKeyboardEverShrunk) return shrunk;
                return true;
            },

            shouldShowMobileOverlay: function() {
                return !!(mobileOverlayEnabled && this.smartphoneNativeInput && !this.closed && !this.hidden && this.isMobileKeyboardOverlayActive());
            },

            setMobileOverlayVisible: function(visible) {
                visible = !!visible;
                this.mobileOverlayVisible = visible;
                if (this.mobileOverlayRoot) this.mobileOverlayRoot.visible = visible;
            },

            updateMobileOverlayVisibility: function() {
                var show = this.shouldShowMobileOverlay();
                this.setMobileOverlayVisible(show);
                if (show) this.refreshMobileOverlay();
            },

            refreshMobileOverlay: function() {
                if (!this.mobileOverlayRoot || !this.mobileOverlayVisible) return;
                this.layoutMobileOverlay();
                this.updateMobileOverlayPicture();
                this.drawMobileOverlayText();
            },

            drawMobileOverlayText: function() {
                if (!this.mobileOverlayTextSprite || !this.mobileOverlayTextSprite.bitmap) return;
                var b = this.mobileOverlayTextSprite.bitmap;
                var textFontSize = Math.max(1, Math.round(fontSize * mobileTextScale / 100));
                var lineHeight = Math.max(20, textFontSize + 8);
                var text = this.value() || placeholder;
                var sidePadding = 12;
                var drawWidth = Math.max(1, mobileBgW - sidePadding * 2);

                b.clear();
                setBitmapFont(b, textFontSize, null, '#f8f8f8', '#000000', 4);
                var textWidth = measureText(b, text);
                var scrollX = 0;
                if (text && textWidth > drawWidth) {
                    scrollX = Math.max(0, textWidth - drawWidth);
                }
                if (!this.value() && placeholder) b.paintOpacity = 128;
                drawTextClippedNoScale(b, text, sidePadding, 0, drawWidth, lineHeight, textWidth > drawWidth ? 'left' : 'center', scrollX);
                b.paintOpacity = 255;
                markBitmapDirty(b);
            },

            bindDomEvents: function() {
                var self = this;
                if (!this.input) return;
                var stop = function(e) {
                    if (e && e.stopPropagation) e.stopPropagation();
                };
                var isEnterEvent = function(e) {
                    return !!(e && (e.key === 'Enter' || e.key === 'NumpadEnter' || e.keyCode === 13 || e.which === 13));
                };
                var isComposingEvent = function(e) {
                    // self.composing は環境やmax到達時に残ることがあるため、Enter送信判定では
                    // 実イベント側のIME状態だけを信用する。
                    return !!(e && (e.isComposing || e.keyCode === 229 || e.which === 229));
                };
                var isAtHardMax = function() {
                    return !!(self.input && max_limit !== null && max_limit >= 0 && String(self.input.value || '').length >= max_limit);
                };
                var clearImeLatch = function() {
                    self.composing = false;
                    self.ignoreEnterUntilKeyup = false;
                };
                var confirmByEnter = function(e) {
                    if (self.closed || self.hidden) return false;
                    if (!isEnterEvent(e)) return false;

                    // keyupで送信すると、IME確定用Enterのkeyupで誤送信しやすい。
                    // 送信はkeydown/keypress/documentのkeydownだけで扱う。
                    if (e && e.type === 'keyup') {
                        clearImeLatch();
                        stop(e);
                        return true;
                    }

                    if (e && e.preventDefault) e.preventDefault();
                    stop(e);
                    self.setValueFromDom(true);

                    // 日本語変換中のEnterは通常は送信しない。ただしmax到達後は、
                    // ブラウザ/IME側のcomposition状態が残りやすいため、送信を許可する。
                    if (isComposingEvent(e) && !isAtHardMax()) {
                        self.composing = true;
                        return true;
                    }

                    clearImeLatch();
                    if (window.Input && Input.clear) Input.clear();
                    self.success();
                    return true;
                };
                var activate = function(e) {
                    if (!self.smartphoneNativeInput) return;
                    stop(e);
                    self.screenAdjust();
                    self.refocus(shouldForceNativeKeyboardRefocus());
                };
                var activateFromRealTouch = function(e) {
                    if (self.closed || self.hidden || !self.input) return;
                    var p = eventToGamePoint(e);
                    if (!p || !self.isInsideInput(p.x, p.y)) return;

                    // iOS/iPadOSでは、MV側のTouchInput更新後ではなく、
                    // 実タップイベント中にfocusしないとソフトウェアキーボードが開かないことがある。
                    // PCブラウザでは透明DOM inputがpointer-events:noneのため、
                    // 一度ゲーム画面クリックでblurした後も、入力欄範囲の実クリックをここで拾って再focusする。
                    stop(e);
                    if (!self.smartphoneNativeInput && e && e.preventDefault) e.preventDefault();
                    self.updateSmartphoneMode(true);
                    self.screenAdjust();
                    self.refocus(self.smartphoneNativeInput && shouldForceNativeKeyboardRefocus());
                    self.consumeTouch();
                };
                var globalEnterHandler = function(e) {
                    if (!window.Input || !Input.form_mode || manager.active !== self) return;
                    // DOM inputのkeydownが届かない環境・フォーカスが外れた瞬間でもEnter確定を拾う。
                    confirmByEnter(e);
                };
                var insertLimitedText = function(text) {
                    if (!self.input || max_limit === null || max_limit < 0) return false;
                    text = String(text == null ? '' : text);
                    var value = String(self.input.value || '');
                    var start = value.length;
                    var end = value.length;
                    if (typeof self.input.selectionStart === 'number') {
                        start = Math.max(0, Math.min(value.length, self.input.selectionStart));
                    }
                    if (typeof self.input.selectionEnd === 'number') {
                        end = Math.max(0, Math.min(value.length, self.input.selectionEnd));
                    }
                    if (end < start) { var t = start; start = end; end = t; }
                    var room = Math.max(0, max_limit - (value.length - (end - start)));
                    var limited = text.slice(0, room);
                    var nextValue = value.slice(0, start) + limited + value.slice(end);
                    nextValue = nextValue.slice(0, max_limit);
                    self.input.value = nextValue;
                    var pos = Math.min(max_limit, start + limited.length);
                    try { self.input.setSelectionRange(pos, pos); } catch (e) {}
                    self.setValueFromDom();
                    return true;
                };
                var hardLimitBeforeInput = function(e) {
                    if (!self.input || max_limit === null || max_limit < 0) return false;
                    if (!e) return false;
                    var inputType = String(e.inputType || '');
                    if (inputType.indexOf('delete') === 0 || inputType === 'historyUndo' || inputType === 'historyRedo') return false;
                    if (inputType === 'insertLineBreak' || isEnterEvent(e)) return false;

                    var data = e.data;
                    if (data === null || data === undefined) data = '';
                    var value = String(self.input.value || '');
                    var start = typeof self.input.selectionStart === 'number' ? self.input.selectionStart : value.length;
                    var end = typeof self.input.selectionEnd === 'number' ? self.input.selectionEnd : value.length;
                    start = Math.max(0, Math.min(value.length, start));
                    end = Math.max(0, Math.min(value.length, end));
                    if (end < start) { var t = start; start = end; end = t; }
                    var room = Math.max(0, max_limit - (value.length - (end - start)));

                    // 1字ずつのキーリピート、IME、貼り付けのいずれでも、上限を超える分は発生前に捨てる。
                    if (room <= 0 || String(data).length > room) {
                        if (e.preventDefault) e.preventDefault();
                        stop(e);
                        // max到達時にキーリピート/IMEのcomposition状態だけが残ると、
                        // 以後のEnterがIME確定扱いになり続けるため、ここで明示的に解除する。
                        clearImeLatch();
                        if (String(data).length > 0 && room > 0) {
                            insertLimitedText(String(data).slice(0, room));
                        } else {
                            self.setValueFromDom();
                        }
                        return true;
                    }
                    return false;
                };

                this.events.push(addEvent(this.input, 'pointerdown', activate, true));
                this.events.push(addEvent(this.input, 'touchstart', activate, true));
                this.events.push(addEvent(this.input, 'touchend', activate, true));
                this.events.push(addEvent(this.input, 'mousedown', activate, true));
                this.events.push(addEvent(this.input, 'click', activate, true));
                this.events.push(addEvent(document, 'pointerdown', activateFromRealTouch, true));
                this.events.push(addEvent(document, 'touchstart', activateFromRealTouch, true));
                this.events.push(addEvent(document, 'touchend', activateFromRealTouch, true));
                this.events.push(addEvent(document, 'mousedown', activateFromRealTouch, true));
                this.events.push(addEvent(document, 'click', activateFromRealTouch, true));

                this.events.push(addEvent(this.input, 'beforeinput', function(e) {
                    if (hardLimitBeforeInput(e)) return;
                    stop(e);
                }, true));
                this.events.push(addEvent(this.input, 'paste', function(e) {
                    if (max_limit === null || max_limit < 0) { stop(e); return; }
                    var text = '';
                    try {
                        text = e && e.clipboardData ? e.clipboardData.getData('text') : '';
                    } catch (ex) { text = ''; }
                    if (text) {
                        if (e && e.preventDefault) e.preventDefault();
                        stop(e);
                        insertLimitedText(text);
                    } else {
                        stop(e);
                        self.setValueFromDom();
                    }
                }, true));

                this.events.push(addEvent(this.input, 'keydown', function(e) {
                    if (confirmByEnter(e)) return;
                    stop(e);
                }, true));
                this.events.push(addEvent(this.input, 'keyup', function(e) {
                    if (isEnterEvent(e)) {
                        clearImeLatch();
                        stop(e);
                        return;
                    }
                    // Backspace/Deleteや通常キーのkeyupで、残留したIME抑止状態を解除する。
                    clearImeLatch();
                    stop(e);
                }, true));
                this.events.push(addEvent(this.input, 'keypress', function(e) {
                    if (confirmByEnter(e)) return;
                    stop(e);
                }, true));
                this.events.push(addEvent(document, 'keydown', globalEnterHandler, true));
                this.events.push(addEvent(window, 'keydown', globalEnterHandler, true));
                this.events.push(addEvent(this.input, 'compositionstart', function(e) {
                    stop(e);
                    self.composing = true;
                    self.ignoreEnterUntilKeyup = false;
                }, true));
                this.events.push(addEvent(this.input, 'compositionupdate', function(e) {
                    stop(e);
                    self.setValueFromDom();
                }, true));
                this.events.push(addEvent(this.input, 'compositionend', function(e) {
                    stop(e);
                    // ここで送信抑止フラグを残さない。max到達後にこのフラグが残ると、
                    // 1文字ずつ消してもEnterが反応しない状態になることがある。
                    clearImeLatch();
                    self.setValueFromDom();
                }, true));
                this.events.push(addEvent(this.input, 'input', function(e) {
                    stop(e);
                    self.setValueFromDom();
                    var inputType = String((e && e.inputType) || '');
                    if (inputType.indexOf('delete') === 0) clearImeLatch();
                }, true));
                this.events.push(addEvent(this.input, 'focus', function() {
                    self.focused = true;
                    self.caretBlink = 0;
                    self.updateMobileViewportBase();
                    self.updateMobileOverlayVisibility();
                    self.refresh();
                }));
                this.events.push(addEvent(this.input, 'blur', function() {
                    self.focused = false;
                    self.setMobileOverlayVisible(false);
                    self.refresh();
                }));
                this.events.push(addEvent(window, 'resize', function(){ self.screenAdjust(); }));
                if (window.visualViewport) {
                    this.events.push(addEvent(window.visualViewport, 'resize', function(){ self.screenAdjust(); self.updateMobileOverlayVisibility(); }));
                    this.events.push(addEvent(window.visualViewport, 'scroll', function(){ self.screenAdjust(); self.updateMobileOverlayVisibility(); }));
                }
            },

            start: function() {
                manager.active = this;
                interpreter.setWaitMode('input_form');
                Input.clear();
                if (window.TouchInput && TouchInput.clear) TouchInput.clear();
                Input.form_mode = true;

                if (if_switch_id > 0) {
                    // 開始時点ですでにONのスイッチは「前回の残り」とみなし、
                    // いったんOFFになってから次のONで閉じる。
                    this.switchArmed = !$gameSwitches.value(if_switch_id);
                }
            },

            isAutoRefocusDisabled: function() {
                return !!(MOBILE_DISABLE_AUTO_REFOCUS && this.smartphoneNativeInput);
            },

            autoRefocus: function() {
                if (this.isAutoRefocusDisabled()) return;
                this.refocus();
            },

            refocus: function(forceRefocus) {
                if (this.hidden) return;
                safeFocus(this.input, !!forceRefocus);
            },

            setValueFromDom: function(skipRefresh) {
                if (!this.input) return;
                var value = String(this.input.value || '');
                if (max_limit !== null && max_limit >= 0 && value.length > max_limit) {
                    var start = typeof this.input.selectionStart === 'number' ? this.input.selectionStart : max_limit;
                    var end = typeof this.input.selectionEnd === 'number' ? this.input.selectionEnd : start;
                    value = value.slice(0, max_limit);
                    this.input.value = value;
                    var pos = Math.max(0, Math.min(value.length, start, end));
                    try { this.input.setSelectionRange(pos, pos); } catch (e) {}
                }
                if (!skipRefresh) this.refresh();
            },

            value: function() {
                var value = this.input ? String(this.input.value || '') : '';
                if (max_limit !== null && max_limit >= 0 && value.length > max_limit) {
                    return value.slice(0, max_limit);
                }
                return value;
            },

            update: function() {
                if (this.closed) return;
                this.setValueFromDom(true);
                this.updateSmartphoneMode();
                this.ensureSceneParent();
                this.updateTouchFocus();
                this.updateSwitchWatch();
                this.screenAdjust();
                this.caretBlink = (Number(this.caretBlink || 0) + 1) % 60;
                this.updateMobileOverlayVisibility();
                if (this.focused || this.lastText !== this.value()) this.refresh();
            },

            ensureSceneParent: function() {
                var scene = getScene();
                if (scene && scene !== this.lastScene) {
                    addSpriteToScene(this.root);
                    addSpriteToScene(this.mobileOverlayRoot);
                    this.lastScene = scene;
                }
            },

            updateTouchFocus: function() {
                if (this.hidden || !window.TouchInput || !TouchInput.isTriggered || !TouchInput.isTriggered()) return;
                var x = TouchInput.x;
                var y = TouchInput.y;
                if (this.isInsideInput(x, y)) {
                    this.refocus(this.smartphoneNativeInput && shouldForceNativeKeyboardRefocus());
                    this.consumeTouch();
                    return;
                }
                if (enableSubmitHit && this.isInsideSubmit(x, y)) {
                    this.setValueFromDom();
                    this.consumeTouch();
                    this.success();
                }
            },

            consumeTouch: function() {
                if (window.TouchInput) {
                    if (typeof TouchInput.suppressEvents === 'function') {
                        TouchInput.suppressEvents();
                    } else if (typeof TouchInput.clear === 'function') {
                        TouchInput.clear();
                    }
                }
            },

            updateSwitchWatch: function() {
                if (if_switch_id <= 0 || !$gameSwitches) return;
                var isOn = $gameSwitches.value(if_switch_id);
                if (!this.switchArmed) {
                    if (!isOn) this.switchArmed = true;
                    return;
                }
                if (isOn) this.cancelBySwitch();
            },

            isInsideInput: function(x, y) {
                return pointInsideRootRect(this.root, 0, 0, width, height, x, y);
            },

            isInsideSubmit: function(x, y) {
                return pointInsideRootRect(this.root, button_x, button_y, button_w, button_h, x, y);
            },

            success: function() {
                this.finish(true, variables_id, false);
            },

            cancelBySwitch: function() {
                // 元仕様どおり、if_s による強制終了では現在値を保存する。
                this.finish(true, variables_id, false);
            },

            setHidden: function(hide) {
                this.hidden = !!hide;
                if (this.root) this.root.visible = !this.hidden;
                if (this.input) {
                    this.input.style.display = this.hidden ? 'none' : '';
                    this.input.style.pointerEvents = this.smartphoneNativeInput && !this.hidden ? 'auto' : 'none';
                }
                if (this.hidden) {
                    this.setMobileOverlayVisible(false);
                    safeBlur(this.input);
                } else {
                    this.autoRefocus();
                    this.updateMobileOverlayVisibility();
                }
            },

            finish: function(writeValue, variableId, external) {
                if (this.closed) return;
                this.closed = true;

                this.setValueFromDom(true);
                var value = this.value();
                var vid = Number(variableId || 0);
                if (writeValue && vid > 0) {
                    $gameVariables.setValue(vid, value);
                }

                removeRegisteredEvents(this.events);
                safeBlur(this.input);
                removeElement(this.input);
                removeSprite(this.root);
                removeSprite(this.mobileOverlayRoot);
                this.input = null;
                this.root = null;
                this.bgSprite = null;
                this.textSprite = null;
                this.mobileOverlayRoot = null;
                this.mobileOverlayBgSprite = null;
                this.mobileOverlayPictureSprite = null;
                this.mobileOverlayTextSprite = null;
                this.lastMobilePictureBitmap = null;

                if (manager.active === this) manager.active = null;

                interpreter.setWaitMode('');
                if (external) clearAllWaitModes();

                Input.form_mode = false;
                Input.clear();
                if (window.TouchInput && TouchInput.clear) TouchInput.clear();
            },

            screenAdjust: function() {
                if (this.closed) return;
                if (this.root) {
                    // x= 省略時だけ、画面幅変更に合わせて中央揃えを維持。
                    if (raw_x === null) this.root.x = Math.round((graphicsWidth() - width) / 2);
                    if (raw_y === null) this.root.y = 0;
                }
                syncDomInputPosition(this.input, this.root, width, height, this.smartphoneNativeInput && !this.hidden);
                this.layoutMobileOverlay();
            },

            refresh: function() {
                this.drawBackground();
                this.drawText();
                this.lastText = this.value();
                this.updateMobileOverlayVisibility();
            },

            drawBackground: function() {
                if (!this.bgSprite || !this.bgSprite.bitmap) return;
                var b = this.bgSprite.bitmap;
                b.clear();
                // 旧CSS版 #_111_input の background: rgba(0,0,0,0.5) / border-radius:12px に寄せる。
                drawRoundedFill(b, 0, 0, b.width, b.height, Math.min(12, Math.floor(b.height / 2)), '#000000', 0.5);
            },

            shouldShowMobileInactivePrompt: function(value) {
                return !!(this.smartphoneNativeInput && !this.focused && !this.hidden && !String(value || '') && mobileInactivePrompt);
            },

            drawText: function() {
                if (!this.textSprite || !this.textSprite.bitmap) return;
                var b = this.textSprite.bitmap;
                b.clear();
                // 旧CSS版に合わせて、白寄りの文字色・太めの黒フチ・中央揃えで描画。
                setBitmapFont(b, fontSize, null, '#f8f8f8', '#000000', 4);
                var value = this.value();
                var showInactivePrompt = this.shouldShowMobileInactivePrompt(value);
                var text = showInactivePrompt ? mobileInactivePrompt : (value || placeholder);
                var x = 12;
                var drawWidth = Math.max(1, width - x * 2);

                // Bitmap.drawText は maxWidth を渡すとCanvas側で長文を縮小描画することがあるため、
                // ここでは自前でクリップし、フォントサイズを固定したまま描画する。
                var lineHeight = Math.max(20, fontSize + 8);
                var textOffsetY = -1; // 微調整：文字を上げたい場合はマイナス、下げたい場合はプラス
                var y = Math.round((height - lineHeight) / 2 + textOffsetY);
                var textWidth = measureText(b, text);
                var scrollX = 0;
                var caretBase = value;
                var caretBaseWidth = 0;

                if (this.input && typeof this.input.selectionStart === 'number') {
                    caretBase = value.slice(0, Math.max(0, Math.min(value.length, this.input.selectionStart)));
                }
                caretBaseWidth = measureText(b, caretBase);
                if (value && textWidth > drawWidth) {
                    var maxScroll = Math.max(0, textWidth - drawWidth);
                    // 長文ではキャレット周辺、通常入力では末尾側を表示する。
                    scrollX = Math.min(maxScroll, Math.max(0, caretBaseWidth - drawWidth + 18));
                }

                var isOverflow = !!(value && textWidth > drawWidth);
                var drawAlign = isOverflow ? 'left' : 'center';
                var textStartX = x - scrollX;
                if (!isOverflow && textWidth < drawWidth) {
                    // 文字列を中央描画している場合、キャレットも同じ左端基準で計算する。
                    textStartX = x + Math.round((drawWidth - textWidth) / 2);
                }

                if (showInactivePrompt) b.paintOpacity = mobileInactivePromptOpacity;
                else if (!value && placeholder) b.paintOpacity = 128;
                drawTextClippedNoScale(b, text, x, y, drawWidth, lineHeight, drawAlign, scrollX);
                b.paintOpacity = 255;

                if (this.focused && !this.hidden && Number(this.caretBlink || 0) < 30) {
                    var caretX = value ? Math.round(textStartX + caretBaseWidth + 2)
                                       : Math.round(x + drawWidth / 2);
                    caretX = Math.max(x, Math.min(x + drawWidth - 3, caretX));
                    var caretHeight = Math.max(20, fontSize + 4);
                    var caretY = Math.round(y + (lineHeight - caretHeight) / 2);
                    b.fillRect(caretX, caretY, 3, caretHeight, '#ffffff');
                }
                markBitmapDirty(b);
            }
        };

        gui.init();
    };

})();
