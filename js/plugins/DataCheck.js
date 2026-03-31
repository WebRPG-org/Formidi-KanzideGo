/*:
 * @target MV
 * @plugindesc 日付チェック用プラグイン
 * @author 
 *
 * @help
 * プラグインコマンド:
 *   DataCheck
 *
 * 実行すると、
 *   ・4/1 の場合          ：変数1550 = "apfl"
 *   ・12/24～12/31 の場合 ：変数1550 = "xmas"
 *   ・それ以外の日付      ：変数1550 = ""
 *
 * PC版・スマホ版共通。
 */

(function() {

  // プラグインコマンド拡張
  var _Game_Interpreter_pluginCommand =
    Game_Interpreter.prototype.pluginCommand;

  Game_Interpreter.prototype.pluginCommand = function(command, args) {
    _Game_Interpreter_pluginCommand.call(this, command, args);

    if (command === "DataCheck") {
      this.dataCheckSeason();
    }
  };

  // 実処理
  Game_Interpreter.prototype.dataCheckSeason = function() {
    var d = new Date();
    var month = d.getMonth() + 1; // 1～12
    var day   = d.getDate();      // 1～31

    var value = "";

    // 4/1 を優先
    if (month === 4 && day === 1) {
      value = "apfl";
    }
    // 12/24～12/31
    else if (month === 12 && day >= 24 && day <= 31) {
      value = "xmas";
    }

    $gameVariables.setValue(1550, value);
  };

})();