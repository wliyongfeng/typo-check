"use strict";

/**
 * Typo is a JavaScript implementation of a spellchecker using hunspell-style
 * dictionaries.
 */

/**
 * Typo constructor.
 *
 * @param {String} [dictionary] The locale code of the dictionary being used. e.g.,
 *                              "en_US". This is only used to auto-load dictionaries.
 * @param {String} [affData] The data from the dictionary's .aff file. If omitted
 *                           and the first argument is supplied, in "chrome" platform,
 *                           the .aff file will be loaded automatically from
 *                           lib/typo/dictionaries/[dictionary]/[dictionary].aff
 *                           In other platform, it will be loaded from
 *                           [setting.path]/dictionaries/[dictionary]/[dictionary].aff
 * @param {String} [wordsData] The data from the dictionary's .dic file. If omitted,
 *                           and the first argument is supplied, in "chrome" platform,
 *                           the .dic file will be loaded automatically from
 *                           lib/typo/dictionaries/[dictionary]/[dictionary].dic
 *                           In other platform, it will be loaded from
 *                           [setting.path]/dictionaries/[dictionary]/[dictionary].dic
 * @param {Object} [settings] Constructor settings. Available properties are:
 *                            {String} [platform]: "chrome" for Chrome Extension or other
 *                              value for the usual web.
 *                            {String} [dictionaryPath]: path to load dictionary from in non-chrome
 *                              environment.
 *                            {Object} [flags]: flag information.
 *
 *
 * @returns {Typo} A Typo object.
 */

function Typo(dictionary, affData, wordsData, settings) {
  settings = settings || {};

  this.rules = {};
  this.dictionaryTable = {};

  this.compoundRules = [];
  this.compoundRuleCodes = {};

  this.replacementTable = [];

  this.flags = settings.flags || {};

  if (dictionary) {

    this.rules = this.parseAFF(affData);

    // Save the rule codes that are used in compound rules.
    this.compoundRuleCodes = {};

    for (var i = 0, len = this.compoundRules.length; i < len; i++) {
      var rule = this.compoundRules[i];

      for (var j = 0, jlen = rule.length; j < jlen; j++) {
        this.compoundRuleCodes[rule[j]] = [];
      }
    }

    // If we add this ONLYINCOMPOUND flag to this.compoundRuleCodes, then parseDIC
    // will do the work of saving the list of words that are compound-only.
    if ("ONLYINCOMPOUND" in this.flags) {
      this.compoundRuleCodes[this.flags.ONLYINCOMPOUND] = [];
    }

    this.dictionaryTable = this.parseDIC(wordsData);

    // Get rid of any codes from the compound rule codes that are never used
    // (or that were special regex characters).  Not especially necessary...
    for (var counter in this.compoundRuleCodes) {
      if (this.compoundRuleCodes[counter].length === 0) {
        delete this.compoundRuleCodes[counter];
      }
    }

    // Build the full regular expressions for each compound rule.
    // I have a feeling (but no confirmation yet) that this method of
    // testing for compound words is probably slow.
    for (var ruleCounter = 0, ruleLen = this.compoundRules.length; ruleCounter < ruleLen; ruleCounter++) {
      var ruleText = this.compoundRules[ruleCounter];

      var expressionText = "";

      for (var textCounter = 0, textLen = ruleText.length; textCounter < textLen; textCounter++) {
        var character = ruleText[textCounter];

        if (character in this.compoundRuleCodes) {
          expressionText += "(" + this.compoundRuleCodes[character].join("|") + ")";
        } else {
          expressionText += character;
        }
      }

      this.compoundRules[ruleCounter] = new RegExp(expressionText, "i");
    }
  }

  return this;
}

Typo.prototype = {
  /**
   * Loads a Typo instance from a hash of all of the Typo properties.
   *
   * @param object obj A hash of Typo properties, probably gotten from a JSON.parse(JSON.stringify(typo_instance)).
   */

  load: function(obj) {
    for (var i in obj) {
      if ({}.hasOwnProperty.call(obj, i)) {
        this[i] = obj[i];
      }
    }

    return this;
  },

  /**
   * Read the contents of a file.
   *
   * @param {String} path The path (relative) to the file.
   * @param {String} [charset="ISO8859-1"] The expected charset of the file
   * @returns string The file data.
   */

  /**
   * Parse the rules out from a .aff file.
   *
   * @param {String} data The contents of the affix file.
   * @returns object The rules from the file.
   */

  parseAFF: function(data) {
    var rules = {};

    // Remove comment lines
    data = this.removeAffixComments(data);

    var lines = data.split("\n");

    for (var i = 0, len = lines.length; i < len; i++) {
      var line = lines[i];

      var definitionParts = line.split(/\s+/);

      var ruleType = definitionParts[0];

      if (ruleType === "PFX" || ruleType === "SFX") {
        var ruleCode = definitionParts[1];
        var combineable = definitionParts[2];
        var numEntries = parseInt(definitionParts[3], 10);

        var entries = [];

        for (var j = i + 1, entryLen = i + 1 + numEntries; j < entryLen; j++) {
          var entryLine = lines[j];

          var lineParts = entryLine.split(/\s+/);
          var charactersToRemove = lineParts[2];

          var additionParts = lineParts[3].split("/");

          var charactersToAdd = additionParts[0];
          if (charactersToAdd === "0") {
            charactersToAdd = "";
          }

          var continuationClasses = this.parseRuleCodes(additionParts[1]);

          var regexToMatch = lineParts[4];

          var entry = {};
          entry.add = charactersToAdd;

          if (continuationClasses.length > 0) {
            entry.continuationClasses = continuationClasses;
          }

          if (regexToMatch !== ".") {
            if (ruleType === "SFX") {
              entry.match = new RegExp(regexToMatch + "$");
            } else {
              entry.match = new RegExp("^" + regexToMatch);
            }
          }

          if (charactersToRemove !== "0") {
            if (ruleType === "SFX") {
              entry.remove = new RegExp(charactersToRemove + "$");
            } else {
              entry.remove = charactersToRemove;
            }
          }

          entries.push(entry);
        }

        rules[ruleCode] = { "type": ruleType, "combineable": (combineable === "Y"), "entries": entries };

        i += numEntries;
      } else if (ruleType === "COMPOUNDRULE") {
        var numEntries1 = parseInt(definitionParts[1], 10);

        for (var jj = i + 1, entriesLen = i + 1 + numEntries1; jj < entriesLen; jj++) {
          var line1 = lines[jj];

          var lineParts0 = line1.split(/\s+/);
          this.compoundRules.push(lineParts0[1]);
        }

        i += numEntries1;
      } else if (ruleType === "REP") {
        var lineParts1 = line.split(/\s+/);

        if (lineParts1.length === 3) {
          this.replacementTable.push([ lineParts1[1], lineParts1[2] ]);
        }
      } else {
        // ONLYINCOMPOUND
        // COMPOUNDMIN
        // FLAG
        // KEEPCASE
        // NEEDAFFIX

        this.flags[ruleType] = definitionParts[1];
      }
    }

    return rules;
  },

  /**
   * Removes comment lines and then cleans up blank lines and trailing whitespace.
   *
   * @param {String} data The data from an affix file.
   * @return {String} The cleaned-up data.
   */

  removeAffixComments: function(data) {
    // Remove comments
    data = data.replace(/#.*$/mg, "");

    // Trim each line
    data = data.replace(/^\s\s*/m, "").replace(/\s\s*$/m, "");

    // Remove blank lines.
    data = data.replace(/\n{2,}/g, "\n");

    // Trim the entire string
    data = data.replace(/^\s\s*/, "").replace(/\s\s*$/, "");

    return data;
  },

  /**
   * Parses the words out from the .dic file.
   *
   * @param {String} data The data from the dictionary file.
   * @returns object The lookup table containing all of the words and
   *                 word forms from the dictionary.
   */

  parseDIC: function(data) {
    data = this.removeDicComments(data);

    var lines = data.split("\n");
    var dictionaryTable = {};

    function addWord(word, rules) {
      // Some dictionaries will list the same word multiple times with different rule sets.
      if (!(word in dictionaryTable) || typeof dictionaryTable[word] !== "object") {
        dictionaryTable[word] = [];
      }

      dictionaryTable[word].push(rules);
    }

    // The first line is the number of words in the dictionary.
    for (var i = 1, lineLen = lines.length; i < lineLen; i++) {
      var line = lines[i];

      var parts = line.split("/", 2);

      var word = parts[0];

      // Now for each affix rule, generate that form of the word.
      if (parts.length > 1) {
        var ruleCodesArray = this.parseRuleCodes(parts[1]);

        // Save the ruleCodes for compound word situations.
        if (!("NEEDAFFIX" in this.flags) || ruleCodesArray.indexOf(this.flags.NEEDAFFIX) === -1) {
          addWord(word, ruleCodesArray);
        }

        for (var j = 0, ruleCodesLen = ruleCodesArray.length; j < ruleCodesLen; j++) {
          var code = ruleCodesArray[j];

          var rule = this.rules[code];

          if (rule) {
            var newWords = this.applyRule(word, rule);

            for (var ii = 0, newWordsLen = newWords.length; ii < newWordsLen; ii++) {
              var newWord = newWords[ii];

              addWord(newWord, []);

              if (rule.combineable) {
                for (var k = j + 1; k < ruleCodesLen; k++) {
                  var combineCode = ruleCodesArray[k];

                  var combineRule = this.rules[combineCode];

                  if (combineRule) {
                    if (combineRule.combineable && (rule.type !== combineRule.type)) {
                      var otherNewWords = this.applyRule(newWord, combineRule);

                      for (var iii = 0, otherNewWordsLen = otherNewWords.length; iii < otherNewWordsLen; iii++) {
                        var otherNewWord = otherNewWords[iii];
                        addWord(otherNewWord, []);
                      }
                    }
                  }
                }
              }
            }
          }

          if (code in this.compoundRuleCodes) {
            this.compoundRuleCodes[code].push(word);
          }
        }
      } else {
        addWord(word.trim(), []);
      }
    }

    return dictionaryTable;
  },


  /**
   * Removes comment lines and then cleans up blank lines and trailing whitespace.
   *
   * @param {String} data The data from a .dic file.
   * @return {String} The cleaned-up data.
   */

  removeDicComments: function(data) {
    // I can't find any official documentation on it, but at least the de_DE
    // dictionary uses tab-indented lines as comments.

    // Remove comments
    data = data.replace(/^\t.*$/mg, "");

//        return data;

    // Trim each line
    data = data.replace(/^\s\s*/m, "").replace(/\s\s*$/m, "");

    // Remove blank lines.
    data = data.replace(/\n{2,}/g, "\n");

    // Trim the entire string
    data = data.replace(/^\s\s*/, "").replace(/\s\s*$/, "");

    return data;
  },

  parseRuleCodes: function(textCodes) {
    if (!textCodes) {
      return [];
    } else if (!("FLAG" in this.flags)) {
      return textCodes.split("");
    } else if (this.flags.FLAG === "long") {
      var flags = [];

      for (var i = 0, codesLen = textCodes.length; i < codesLen; i += 2) {
        flags.push(textCodes.substr(i, 2));
      }

      return flags;
    } else if (this.flags.FLAG === "num") {
      return textCodes.split(",");
    }
  },

  /**
   * Applies an affix rule to a word.
   *
   * @param {String} word The base word.
   * @param {Object} rule The affix rule.
   * @returns {String[]} The new words generated by the rule.
   */

  applyRule: function(word, rule) {
    var entries = rule.entries;
    var newWords = [];

    for (var i = 0, entriesLen = entries.length; i < entriesLen; i++) {
      var entry = entries[i];

      if (!entry.match || word.match(entry.match)) {
        var newWord = word;

        if (entry.remove) {
          newWord = newWord.replace(entry.remove, "");
        }

        if (rule.type === "SFX") {
          newWord = newWord + entry.add;
        } else {
          newWord = entry.add + newWord;
        }

        newWords.push(newWord);

        if ("continuationClasses" in entry) {
          for (var j = 0, classesLen = entry.continuationClasses.length; j < classesLen; j++) {
            var continuationRule = this.rules[entry.continuationClasses[j]];

            if (continuationRule) {
              newWords = newWords.concat(this.applyRule(newWord, continuationRule));
            }
            /*
             else {
             // This shouldn't happen, but it does, at least in the de_DE dictionary.
             // I think the author mistakenly supplied lower-case rule codes instead
             // of upper-case.
             }
             */
          }
        }
      }
    }

    return newWords;
  },

  /**
   * Checks whether a word or a capitalization variant exists in the current dictionary.
   * The word is trimmed and several variations of capitalizations are checked.
   * If you want to check a word without any changes made to it, call checkExact()
   *
   * @see http://blog.stevenlevithan.com/archives/faster-trim-javascript re:trimming function
   *
   * @param {String} aWord The word to check.
   * @returns {Boolean}
   */

  check: function(aWord) {
    // Remove leading and trailing whitespace
    var trimmedWord = aWord.replace(/^\s\s*/, "").replace(/\s\s*$/, "");

    if (this.checkExact(trimmedWord)) {
      return true;
    }

    // The exact word is not in the dictionary.
    if (trimmedWord.toUpperCase() === trimmedWord) {
      // The word was supplied in all uppercase.
      // Check for a capitalized form of the word.
      var capitalizedWord = trimmedWord[0] + trimmedWord.substring(1).toLowerCase();

      if (this.hasFlag(capitalizedWord, "KEEPCASE")) {
        // Capitalization variants are not allowed for this word.
        return false;
      }

      if (this.checkExact(capitalizedWord)) {
        return true;
      }
    }

    var lowercaseWord = trimmedWord.toLowerCase();

    if (lowercaseWord !== trimmedWord) {
      if (this.hasFlag(lowercaseWord, "KEEPCASE")) {
        // Capitalization variants are not allowed for this word.
        return false;
      }

      // Check for a lowercase form
      if (this.checkExact(lowercaseWord)) {
        return true;
      }
    }

    return false;
  },

  /**
   * Checks whether a word exists in the current dictionary.
   *
   * @param {String} word The word to check.
   * @returns {Boolean}
   */

  checkExact: function(word) {
    var ruleCodes = this.dictionaryTable[word];

    if (typeof ruleCodes === "undefined") {
      // Check if this might be a compound word.
      if ("COMPOUNDMIN" in this.flags && word.length >= this.flags.COMPOUNDMIN) {
        for (var i = 0, rulesLen = this.compoundRules.length; i < rulesLen; i++) {
          if (word.match(this.compoundRules[i])) {
            return true;
          }
        }
      }

      return false;
    } else {
      for (var counter = 0, ruleCodesLen = ruleCodes.length; counter < ruleCodesLen; counter++) {
        if (!this.hasFlag(word, "ONLYINCOMPOUND", ruleCodes[counter])) {
          return true;
        }
      }

      return false;
    }
  },

  /**
   * Looks up whether a given word is flagged with a given flag.
   *
   * @param {String} word The word in question.
   * @param {String} flag The flag in question.
   * @return {Boolean}
   */

  hasFlag: function(word, flag, wordFlags) {
    if (flag in this.flags) {
      if (typeof wordFlags === "undefined") {
        wordFlags = Array.prototype.concat.apply([], this.dictionaryTable[word]);
      }

      if (wordFlags && wordFlags.indexOf(this.flags[flag]) !== -1) {
        return true;
      }
    }

    return false;
  },

  /**
   * Returns a list of suggestions for a misspelled word.
   *
   * @see http://www.norvig.com/spell-correct.html for the basis of this suggestor.
   * This suggestor is primitive, but it works.
   *
   * @param {String} word The misspelling.
   * @param {Number} [limit=5] The maximum number of suggestions to return.
   * @returns {String[]} The array of suggestions.
   */

  alphabet: "",

  suggest: function(word, limit) {
    if (!limit) {
      limit = 5;
    }

    if (this.check(word)) {
      return [];
    }

    // Check the replacement table.
    for (var i = 0, tableLen = this.replacementTable.length; i < tableLen; i++) {
      var replacementEntry = this.replacementTable[i];

      if (word.indexOf(replacementEntry[0]) !== -1) {
        var correctedWord = word.replace(replacementEntry[0], replacementEntry[1]);

        if (this.check(correctedWord)) {
          return [ correctedWord ];
        }
      }
    }

    var self = this;
    self.alphabet = "abcdefghijklmnopqrstuvwxyz";

    /*
     if (!self.alphabet) {
     // Use the alphabet as implicitly defined by the words in the dictionary.
     var alphaHash = {};

     for (var i in self.dictionaryTable) {
     for (var j = 0, _len = i.length; j < _len; j++) {
     alphaHash[i[j]] = true;
     }
     }

     for (var i in alphaHash) {
     self.alphabet += i;
     }

     var alphaArray = self.alphabet.split("");
     alphaArray.sort();
     self.alphabet = alphaArray.join("");
     }
     */

    function edits1(words) {
      var rv = [];

      for (var ii = 0, wordsLen = words.length; ii < wordsLen; ii++) {
        var singleWord = words[ii];

        var splits = [];

        for (var wordCounter = 0, wordLen = singleWord.length + 1; wordCounter < wordLen; wordCounter++) {
          splits.push([ singleWord.substring(0, wordCounter), singleWord.substring(wordCounter, singleWord.length) ]);
        }

        var deletes = [];

        for (var counter = 0, len = splits.length; counter < len; counter++) {
          var s = splits[counter];

          if (s[1]) {
            deletes.push(s[0] + s[1].substring(1));
          }
        }

        var transposes = [];

        for (var splitsCounter = 0, splitsLen = splits.length; splitsCounter < splitsLen; splitsCounter++) {
          var split = splits[splitsCounter];

          if (split[1].length > 1) {
            transposes.push(split[0] + split[1][1] + split[1][0] + split[1].substring(2));
          }
        }

        var replaces = [];

        for (var splitsCounter1 = 0, splitsLen1 = splits.length; splitsCounter1 < splitsLen1; splitsCounter1++) {
          var split1 = splits[splitsCounter1];

          if (split1[1]) {
            for (var j = 0, alpahbetLen = self.alphabet.length; j < alpahbetLen; j++) {
              replaces.push(split1[0] + self.alphabet[j] + split1[1].substring(1));
            }
          }
        }

        var inserts = [];

        for (var splitsCounter2 = 0, splitsLen2 = splits.length; splitsCounter2 < splitsLen2; splitsCounter2++) {
          var split2 = splits[splitsCounter2];

          if (split2[1]) {
            for (var alphCounter = 0, alphLen = self.alphabet.length; alphCounter < alphLen; alphCounter++) {
              replaces.push(split2[0] + self.alphabet[alphCounter] + split2[1]);
            }
          }
        }

        rv = rv.concat(deletes);
        rv = rv.concat(transposes);
        rv = rv.concat(replaces);
        rv = rv.concat(inserts);
      }

      return rv;
    }

    function known(words) {
      var rv = [];

      for (var counter = 0; counter < words.length; counter++) {
        if (self.check(words[counter])) {
          rv.push(words[counter]);
        }
      }

      return rv;
    }

    function correct(word) {
      // Get the edit-distance-1 and edit-distance-2 forms of this word.
      var ed1 = edits1([word]);
      var ed2 = edits1(ed1);

      var corrections = known(ed1).concat(known(ed2));

      // Sort the edits based on how many different ways they were created.
      var weightedCorrections = {};

      for (var counter = 0, correctionsLen = corrections.length; counter < correctionsLen; counter++) {
        if (!(corrections[counter] in weightedCorrections)) {
          weightedCorrections[corrections[counter]] = 1;
        } else {
          weightedCorrections[corrections[counter]] += 1;
        }
      }

      var sortedCorrections = [];

      for (var correction in weightedCorrections) {
        if ({}.hasOwnProperty.call(weightedCorrections, correction)) {
          sortedCorrections.push([ correction, weightedCorrections[correction] ]);
        }
      }

      function sorter(a, b) {
        if (a[1] < b[1]) {
          return -1;
        }

        return 1;
      }

      sortedCorrections.sort(sorter).reverse();

      var rv = [];

      for (var counter1 = 0, length = Math.min(limit, sortedCorrections.length); counter1 < length; counter1++) {
        if (!self.hasFlag(sortedCorrections[counter1][0], "NOSUGGEST")) {
          rv.push(sortedCorrections[counter1][0]);
        }
      }

      return rv;
    }

    return correct(word);
  }
};

module.exports = Typo;
