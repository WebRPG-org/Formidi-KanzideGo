/* 111_InputForm_ForceClose.js
   111_InputFormのフォームを強制終了/非表示にする拡張コマンド

   iPad/Safari安定化版：
   - InputForm kill/success/cancel/hide を通常フォーム作成より先に処理
   - 111_InputForm.js 側の監視タイマー・イベントもまとめて解除
   - 読み込み順が前後しても、最低限DOM除去と待機解除が働くように保険を追加
*/
(function(){
  'use strict';

  var MANAGER_NAME = '_111InputFormManager';

  function getManager(){
    if(!window[MANAGER_NAME]) window[MANAGER_NAME] = {};
    return window[MANAGER_NAME];
  }

  function clearWaitMode(it){
    if(it && it._waitMode === 'input_form') it.setWaitMode('');
  }

  function clearAllWaits(){
    try {
      clearWaitMode($gameMap && $gameMap._interpreter);
      clearWaitMode($gameTroop && $gameTroop._interpreter);
      if($gameMap && $gameMap._commonEvents){
        $gameMap._commonEvents.forEach(function(ce){
          if(ce && ce._interpreter) clearWaitMode(ce._interpreter);
        });
      }
    } catch(e) {
      // 起動直後など、ゲーム側グローバルが未初期化のときの保険
    }
  }

  function removeElement(el){
    if(el && el.parentNode) el.parentNode.removeChild(el);
  }

  function getInput(){
    return document.getElementById('_111_input');
  }

  function getSubmit(){
    return document.getElementById('_111_submit');
  }

  function removeDomOnly(){
    removeElement(getInput());
    removeElement(getSubmit());
    if(window.Input) Input.form_mode = false;
    if(window.Input && Input.clear) Input.clear();
    if(window.TouchInput && TouchInput.clear) TouchInput.clear();
    clearAllWaits();
  }

  function parseVariableId(args){
    // 例：InputForm success v=11
    for(var i = 1; i < args.length; i++){
      var text = String(args[i] || '');
      var m = text.match(/(?:^|;)v\s*=\s*(\d+)/i);
      if(m) return Number(m[1] || 0);
    }
    return 0;
  }

  function forceClose(writeValue, variableId){
    var manager = getManager();

    if(manager.active && manager.active.finish){
      manager.active.finish(!!writeValue, variableId || 0, true);
      return;
    }

    if(manager.forceClose){
      manager.forceClose(!!writeValue, variableId || 0);
      return;
    }

    // 111_InputForm.jsが未パッチ/未読込でも最低限動く保険
    var inp = getInput();
    if(writeValue && variableId > 0 && inp){
      $gameVariables.setValue(variableId, inp.value);
    }
    removeDomOnly();
  }

  function hideForm(hide){
    var manager = getManager();
    if(manager.hide){
      manager.hide(!!hide);
      return;
    }

    var inp = getInput();
    var sub = getSubmit();
    var d = hide ? 'none' : '';
    if(inp) inp.style.display = d;
    if(sub) sub.style.display = d;
  }

  // 使い方：
  // InputForm kill            … 強制終了（値は書かずに終了）
  // InputForm success v=11    … 変数11に現在の入力値を入れて終了
  // InputForm cancel          … 値は書かずに終了
  // InputForm hide on/off     … 表示の一時非表示/再表示（終了はしない）
  var _pc = Game_Interpreter.prototype.pluginCommand;
  Game_Interpreter.prototype.pluginCommand = function(command,args){
    args = args || [];

    if(command === 'InputForm'){
      var sub = String(args[0] || '').toLowerCase();

      // 重要：
      // 先に _pc.call すると、InputForm kill などが通常フォーム作成として処理される場合がある。
      // そのため、ForceClose系サブコマンドはここで処理してから return する。
      if(sub === 'kill'){
        forceClose(false, 0);
        return;
      }

      if(sub === 'success'){
        forceClose(true, parseVariableId(args));
        return;
      }

      if(sub === 'cancel'){
        forceClose(false, 0);
        return;
      }

      if(sub === 'hide'){
        var onoff = String(args[1] || '').toLowerCase();
        hideForm(onoff === 'on');
        return;
      }
    }

    _pc.call(this, command, args);
  };

  // 111_InputForm.js側からも使える保険
  var manager = getManager();
  manager.clearAllWaitModes = manager.clearAllWaitModes || clearAllWaits;
  manager.removeStrayFormElements = manager.removeStrayFormElements || removeDomOnly;
  manager.forceClose = manager.forceClose || forceClose;
  manager.hide = manager.hide || hideForm;
})();
