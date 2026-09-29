import type { Passage } from '../lib/types';

/**
 * 教材 (reading materials).
 *
 * SOURCE AND VERIFICATION STATUS
 * - Base text (2026-09-29): 劉義慶編撰、顏興林注釋《世說新語》, 新北：布拉格文創社,
 *   2019 初版, ISBN 978-986-98221-2-1 (read on HyRead via NTHU), 汰侈第三十 pp. 444–450.
 *   Collated against it:
 *     P0 = entry 石崇廁 (p. 445)           — whole passage
 *     T2 = 武帝嘗降王武子家 + 石崇與王愷爭豪 — second half only (pp. 448–449)
 *     T1 = 石崇為客作豆粥 + 彭城王有快牛     — first half only (pp. 446–447)
 *   Second edition (2026-09-29, user's photos of the printed book): 張撝之譯注《世說新語譯注》下冊，汰侈第三十（清大人社分館 857.1351 7280-2 v.2；出版項待補）.
 *   It prints all of 汰侈 in simplified characters with 注釋 and 譯文, and is the source for
 *   the two entries 顏興林 omits:
 *     武帝嘗降王武子家 (p. 424) — wording matches 維基文庫, PLUS the final sentence
 *       「王、石所未知作。」 as 正文 with its own note ⑦. 戴建業《慢讀世說新語最風流》
 *       (啟動文化, 2020) also prints it as 正文, so it is now in T2. 維基文庫 had set it
 *       apart with a textual note; that was the source of the earlier omission.
 *     彭城王有快牛 (p. 427) — adds the comma in 「君欲自乘，則不論」.
 *   Where the two editions disagree on WORDING, 張撝之 wins (full scholarly 譯注 vs a
 *   selection): 「如愷許比甚眾」 without 者 (顏興林 has 「比者」; 維基文庫 agrees with 張).
 *   Where 張撝之's simplified form is ambiguous in traditional script (干→幹, 萍/蓱, 齑,
 *   沉/沈, 恒), the traditional form follows 顏興林 or, for 武帝/彭城王 entries, 維基文庫.
 *   Simplified-merged characters keep the traditional reading (啖 in 張 → 噉 here).
 *   Third edition (2026-09-29, user's photos): 劉正浩、邱燮友、陳滿銘、許錟輝、黃俊郎注譯
 *   《新譯世說新語》, 臺北：三民書局（古籍今注新譯叢書）, 汰侈第三十 pp. 859–869 (NTHU
 *   reserve copy C0016886; edition year not yet recorded). Used as a COLLATION witness, not
 *   as the base: on every substantive variant below, 張撝之, 顏興林 and 維基文庫 agree with
 *   each other and 三民 stands alone, which points to a different underlying 底本.
 *   三民 readings NOT adopted (校記):
 *     武帝嘗降王武子家  「悉用瑠璃器」 (others 「並用」)
 *     石崇廁            「又與新衣箸令出」 (others 「著」)
 *     石崇與王愷爭豪    「聲色方厲」 (others 「甚厲」); 「條榦絕俗、光采溢目者」
 *                       (others 「條幹／條榦絕世，光彩溢目者」)
 *     石崇為客作豆粥    「愷每以此三事為搤腕」 (others no 「愷」);
 *                       「牛本不遲，良由馭者逐之不及而反制之」 (others 「由將車人不及制之爾」;
 *                       張撝之 note ⑦ says this is the 《晉書·石崇傳》 reading)
 *   Split readings, base (張撝之) kept: 「如愷許比甚眾」 — 顏興林 and 三民 both print 「比者」.
 *   Confirmed by 三民: 「王、石所未知作。」 is 正文 (third edition to print it so; note ⑧).
 *   For the translation rater: where 三民 differs, its 語譯 translates ITS text, so accept
 *   either reading of those clauses when scoring.
 *   Kept against the edition on purpose: 「搤腕」 — the ebook prints 「為腕」 but its own
 *   note ③ glosses 「搤腕」, so the missing 「搤」 is a rendering loss, not a reading.
 *   `verified` stays false until every entry is collated and a reviewer signs off.
 * - The edition's 譯文 is NOT stored here (copyright). It is the scoring reference for the
 *   open translation items, used offline by the rater.
 * - ANNOTATION GLOSSES: where the edition annotates a term the platform glosses, its note
 *   replaces the dictionary gloss and is cited by page. The term SET is unchanged except
 *   條榦 (removed, see below). The edition's other notes (藻飾, 枝柯, 許/比, 惘然/自失 …) are
 *   not added: annotations stay limited to rare words and proper nouns, and a note on
 *   「許：那樣」 would sit beside S3-05, which tests the other 「許」 (高二尺許).
 *   Remaining glosses are copied from a named dictionary and carry their `source`:
 *     萌典 / 教育部《重編國語辭典修訂本》  https://www.moedict.tw/<詞>
 *     漢典 (for entries 教育部辭典 does not carry)  https://www.zdic.net/hans/<詞>
 *     法鼓文理學院 人名規範資料庫  https://authority.dila.edu.tw/person/
 *     維基百科 (proper nouns only)
 *   Where a gloss joins two dictionary entries into one compound (鐵如意),
 *   the join is the system author's, not the dictionary's, and is marked 「合指」.
 *   A 中文系 reviewer must still sign these off before collection.
 * - Target-sentence explanations below are DRAFTS written by the system author, not taken
 *   from an annotated edition. Every entry marked `draft: true` must be replaced or
 *   confirmed. `npm run validate:content` fails while drafts remain.
 *
 * v6 (2026-09-29) CHANGES
 * - Standard translation = 三民《新譯世說新語》語譯 (WCC's decision, 2026-09-29). Every
 *   target explanation and every translation-item explanation/reference below quotes it,
 *   by page, and is shown to readers. This reverses the v5 rule 「譯文 NOT stored here」:
 *   the repository must stay private, only the sentences the study uses are included, and
 *   the thesis appendix cites the pages instead of reprinting them.
 * - 汰侈 (pretest + training) / 儉嗇 (post-tests): every post-test passage is unseen and from
 *   another chapter. The v5 transfer passage T1 (汰侈 5＋11) is split: 汰侈 5 becomes
 *   training passage T5, 汰侈 11 becomes the S1b baseline passage B11. The S6 delayed-test
 *   passage (周書·王褒傳) is removed with the delayed test.
 * - New passages T6 (汰侈 6) and J1/J7/J9 (儉嗇 1/7/9) are transcribed from 三民 (汰侈 6
 *   p. 864; 儉嗇 pp. 853–857). 儉嗇 was also photographed in 張撝之 (pp. 420–422); variants
 *   noted per passage. `verified` stays false until a reviewer signs off.
 * - Translation stages show only proper-noun glosses plus 「上直」 (a 通假 no reader can be
 *   expected to know); every word a scoring point depends on is left unglossed.
 */

const T2_TEXT =
  '武帝嘗降王武子家，武子供饌，並用瑠璃器。婢子百餘人，皆綾羅絝𧟌，以手擎飲食。烝㹠肥美，異於常味。帝怪而問之，答曰：「以人乳飲㹠。」帝甚不平，食未畢，便去。王、石所未知作。' +
  '石崇與王愷爭豪，並窮綺麗，以飾輿服。武帝，愷之甥也，每助愷。嘗以一珊瑚樹高二尺許賜愷，枝柯扶疏，世罕其比。愷以示崇，崇視訖，以鐵如意擊之，應手而碎。愷既惋惜，又以為疾己之寶，聲色甚厲。崇曰：「不足恨，今還卿。」乃命左右悉取珊瑚樹，有三尺、四尺，條幹絕世，光彩溢目者六七枚，如愷許比甚眾。愷惘然自失。';

const PRETEST_TEXT =
  '石崇廁，常有十餘婢侍列，皆麗服藻飾。置甲煎粉、沉香汁之屬，無不畢備。又與新衣著令出，客多羞不能如廁。王大將軍往，脫故衣，著新衣，神色傲然。群婢相謂曰：「此客必能作賊！」';

const countChars = (s: string) => s.replace(/[^一-鿿]/g, '').length;

export const PRETEST_PASSAGE: Passage = {
  id: 'P0',
  title: '世說新語·汰侈 2（石崇廁）',
  displayTitle: '短文（一）',
  source: '劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 445',
  verified: false,
  text: PRETEST_TEXT,
  charCount: countChars(PRETEST_TEXT),
  annotations: [
    {
      term: '甲煎粉',
      gloss: '一種香粉。',
      kind: 'rare_word',
      source: '劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 445 注②',
    },
    {
      term: '沉香汁',
      gloss: '沉香木製成的香水。',
      kind: 'rare_word',
      source: '劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 445 注②',
    },
    {
      term: '王大將軍',
      gloss: '王敦（266–324），字處仲，東晉初官至大將軍。',
      kind: 'proper_noun',
      source: '維基百科「王敦」 https://zh.wikipedia.org/wiki/王敦',
    },
  ],
  targets: [],
};

export const LEARNING_PASSAGE: Passage = {
  id: 'T2',
  title: '世說新語·汰侈 3＋8（人乳飲㹠、珊瑚樹）',
  displayTitle: '短文（三）',
  source: '前半 張撝之《世說新語譯注》頁 424；後半 劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 448–449',
  verified: false,
  text: T2_TEXT,
  charCount: countChars(T2_TEXT),
  annotations: [
    {
      term: '瑠璃器',
      gloss: '瑠璃：一種有色半透明的礦石，學名青金石，被看作貴重材料。瑠璃器即瑠璃製的器皿。',
      kind: 'rare_word',
      source: '張撝之譯注《世說新語譯注》下冊，汰侈第三十（清大人社分館 857.1351 7280-2 v.2；出版項待補） 頁 424 注②（「瑠璃器」三字合指為系統作者所加）',
    },
    {
      term: '綾羅絝𧟌',
      gloss: '綾羅：細緻柔軟而有光彩的絲織品。絝：同「褲」，褲子。𧟌（ㄌㄨㄛˊ）：女子上衣。',
      kind: 'rare_word',
      source: '絝、𧟌：張撝之譯注《世說新語譯注》下冊，汰侈第三十（清大人社分館 857.1351 7280-2 v.2；出版項待補） 頁 424 注③；綾羅：萌典 https://www.moedict.tw/綾羅',
    },
    {
      term: '烝㹠',
      gloss: '烝：通「蒸」。㹠：同「豚」，小豬。',
      kind: 'rare_word',
      source: '張撝之譯注《世說新語譯注》下冊，汰侈第三十（清大人社分館 857.1351 7280-2 v.2；出版項待補） 頁 424 注⑤',
    },
    {
      term: '王、石',
      gloss: '王愷、石崇。',
      kind: 'proper_noun',
      source: '張撝之譯注《世說新語譯注》下冊，汰侈第三十（清大人社分館 857.1351 7280-2 v.2；出版項待補） 頁 424 注⑦',
    },
    {
      term: '扶疏',
      gloss: '枝葉繁茂紛披貌。',
      kind: 'rare_word',
      source: '劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 448–449 注①（「枝柯：樹枝。扶疏：枝葉繁茂紛披貌。」只取「扶疏」一半）',
    },
    // 條榦 removed 2026-09-29: the gloss existed only because of the variant 「榦」; the
    // 顏興林 edition prints 「條幹」 and gives no note, so the annotation set follows it.
    {
      term: '鐵如意',
      gloss: '如意：原為搔背的用具，後演變為象徵吉祥的擺飾。合指鐵製的如意。',
      kind: 'rare_word',
      source: '教育部《重編國語辭典修訂本》「如意」（dictView ID=136449）',
    },
    {
      term: '武帝',
      gloss: '晉武帝司馬炎，西晉開國皇帝。',
      kind: 'proper_noun',
      source: '法鼓文理學院人名規範資料庫 A017804（該條記常山公主為司馬炎之女、司馬炎為西晉首位皇帝）',
    },
    {
      term: '王武子',
      gloss: '王濟，字武子，太尉王渾之子，娶晉武帝之女常山公主。',
      kind: 'proper_noun',
      source: '法鼓文理學院人名規範資料庫 https://authority.dila.edu.tw/person/search.php?aid=A017804',
    },
    {
      term: '石崇',
      gloss: '石崇（249–300），字季倫，西晉鉅富，以與王愷鬥富著名。',
      kind: 'proper_noun',
      source: '維基百科「石崇」 https://zh.wikipedia.org/wiki/石崇',
    },
    {
      term: '王愷',
      gloss: '王愷，字君夫，其姊王元姬為晉武帝之母，故武帝稱其為舅；以與石崇鬥富著名。',
      kind: 'proper_noun',
      source: '維基百科「王愷」 https://zh.wikipedia.org/wiki/王愷_(西晉)',
    },
  ],
  targets: [
    {
      id: 'TS1',
      text: '以鐵如意擊之，應手而碎',
      languagePoint: '以＝介詞；之＝代詞',
      // 三民本語譯 p. 866 「用鐵如意敲打，珊瑚樹隨手便破碎了」
      explanation: '（草稿）白話：用鐵如意敲打，珊瑚樹隨手便破碎了。「以」是「用」；「之」指珊瑚樹。',
      choice: {
        prompt: '「擊之」的「之」在這句話裡的作用比較像哪一個？',
        options: ['的', '指某個東西', '往、去'],
        answerIndex: 1,
        whyWrong: [
          '（草稿）「的」要接在兩個名詞之間，這裡後面沒有名詞。',
          '',
          '（草稿）作「往、去」時後面會接地點，這裡沒有。',
        ],
      },
      // 每一層都指名要看的那個字。舊版四句共用「這個字在句子什麼位置？」，
      // 但讀者點的是整句，畫面上沒有任何東西指出「這個字」是哪一個字。
      // v6: rungs ask for the clues a translation needs (who does what, to what, with what).
      layer1: '這句有「擊」和「碎」兩個動作。是誰拿什麼去「擊」？請從前文找出人和工具。',
      layer1Choice: {
        options: ['一個動作（敲、打）', '一個東西（器物）', '一個形容的詞'],
        answerIndex: 0,
      },
      layer2: '「擊之」被敲的是前文提到的哪一樣東西？「碎」的又是什麼？',
      layer2Choice: {
        options: ['在「擊」的前面', '在「擊」的後面', '這句話裡沒有寫出來'],
        answerIndex: 1,
      },
      acceptableAnswers: ['代詞', '代名詞', '指珊瑚樹', '被敲的東西', '它'],
      draft: true,
      required: true,
    },
    {
      id: 'TS2',
      text: '武帝，愷之甥也',
      languagePoint: '之＝助詞；判斷句',
      // 三民本語譯 p. 866 「晉武帝，是王愷的外甥」
      explanation: '（草稿）白話：晉武帝，是王愷的外甥。「之」相當於「的」；「……也」表示判斷。',
      choice: {
        prompt: '「愷之甥也」的「之」在這裡的作用比較像哪一個？',
        options: ['的', '指某個東西', '往、去'],
        answerIndex: 0,
        whyWrong: [
          '',
          '（草稿）作代詞時會接在動作後面，這裡前後都是名詞。',
          '（草稿）作「往、去」時後面接地點。',
        ],
      },
      layer1: '觀察「愷」「之」「甥」的排列：「之」前後的字各指哪一類對象？',
      layer1Choice: {
        options: ['都是人或身分（名詞）', '都是動作', '一個是動作，一個是名詞'],
        answerIndex: 0,
      },
      layer2: '「愷」與「甥」在句中相隔一字；請比較它們與「之」的位置，再說明你看到的關係線索。',
      layer2Choice: {
        options: ['把後面那個身分歸到前面那個人身上', '表示一個動作', '表示時間的先後'],
        answerIndex: 0,
      },
      acceptableAnswers: ['的', '助詞', '相當於的'],
      draft: true,
    },
    {
      id: 'TS3',
      text: '光彩溢目者六七枚',
      languagePoint: '者＝定語後置標記',
      // 三民本語譯 p. 866 「光華四射的六七株」
      explanation: '（草稿）白話：光華四射的（珊瑚樹）有六七株。「者」把「光彩溢目」接到被形容的珊瑚樹上。',
      choice: {
        prompt: '「光彩溢目者六七枚」說的是什麼有六七枚？',
        options: ['光彩', '珊瑚樹', '眼睛'],
        answerIndex: 1,
        whyWrong: ['（草稿）光彩不能用「枚」計算。', '', '（草稿）文中沒有在數眼睛。'],
      },
      layer1: '觀察「光彩溢目」與「六七枚」：兩段文字各提供哪一類資訊？你從哪些字看出來？',
      layer1Choice: {
        options: ['描述一個東西的樣子', '說一個動作', '說一個時間'],
        answerIndex: 0,
      },
      // 層二問「者」的功能，層三才問它指的是什麼，兩層不重複。
      layer2: '「者」位於描述與數量之間；比較前後文字，你看到什麼連接線索？',
      layer2Choice: {
        options: ['把一段形容接到被形容的東西上', '表示這是一個問句', '表示「……的時候」'],
        answerIndex: 0,
      },
      acceptableAnswers: ['珊瑚樹', '珊瑚', '樹'],
      draft: true,
    },
    {
      id: 'TS4',
      text: '並窮綺麗，以飾輿服',
      languagePoint: '以＝連詞（來）',
      // 三民本語譯 p. 866 「全用盡家中華美的物品，拿來裝飾車馬衣服」
      explanation: '（草稿）白話：全用盡家中華美的物品，拿來裝飾車馬衣服。「以」相當於「來」，接著說目的。',
      choice: {
        prompt: '「以飾輿服」的「以」比較像哪一個意思？',
        options: ['用（某個工具）', '來（做某件事）', '因為'],
        answerIndex: 1,
        whyWrong: ['（草稿）作「用」時後面會接名詞，這裡後面是動作「飾」。', '', '（草稿）文中沒有在說原因。'],
      },
      layer1: '這句的主語在前文：是誰「並窮綺麗」？「並」提示了有幾個人？',
      layer1Choice: {
        options: ['一個動作（裝飾）', '一個東西（飾品）', '一個形容的詞'],
        answerIndex: 0,
      },
      layer2: '「窮綺麗」和「飾輿服」兩件事，哪一件是做法、哪一件是要達到的結果？從哪個字看出來？',
      layer2Choice: {
        options: ['前面是做法，後面是要達到的目的', '前面是原因，後面是結果', '兩件互不相干的事'],
        answerIndex: 0,
      },
      acceptableAnswers: ['來', '連詞', '用來'],
      draft: true,
      required: true,
    },
  ],
};


const SANMIN = '劉正浩、邱燮友、陳滿銘、許錟輝、黃俊郎注譯《新譯世說新語》（臺北：三民書局，古籍今注新譯叢書；出版年待補）';
const ZHANG = '張撝之譯注《世說新語譯注》下冊（清大人社分館 857.1351 7280-2 v.2；出版項待補）';

/* ------------------------------------------------------------------ */
/* Training passage 2 — 汰侈 5（石崇為客作豆粥）                        */
/* ------------------------------------------------------------------ */

const T5_TEXT =
  '石崇為客作豆粥，咄嗟便辦。恒冬天得韭蓱虀。又牛形狀氣力不勝王愷牛，而與愷出遊，極晚發，爭入洛城，崇牛數十步後迅若飛禽，愷牛絕走不能及。每以此三事為搤腕，乃密貨崇帳下都督及御車人，問所以。都督曰：「豆至難煮，唯豫作熟末，客至，作白粥以投之。韭蓱虀是搗韭根，雜以麥苗爾。」復問馭人牛所以駛，馭人云：「牛本不遲，由將車人不及制之爾。急時聽偏轅，則駛矣。」愷悉從之，遂爭長。石崇後聞，皆殺告者。';

export const T5_PASSAGE: Passage = {
  id: 'T5',
  title: '世說新語·汰侈 5（豆粥）',
  displayTitle: '短文（四）',
  source: '劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 446–447（v5 T1 前半；三民本異文見檔頭校記）',
  verified: false,
  text: T5_TEXT,
  charCount: countChars(T5_TEXT),
  annotations: [
    { term: '咄嗟', gloss: '本是叱吒的聲音，這裡引申為一呼、一叫。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 863 注②` },
    { term: '韭蓱虀', gloss: '用韭菜、麥苗搗碎後做成的菜。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 863 注④` },
    { term: '搤腕', gloss: '自己一手握緊另一手腕，表示激憤不平或振奮。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 863 注⑦` },
    { term: '都督', gloss: '官名。高級軍事長官。', kind: 'proper_noun', source: `${SANMIN} 汰侈第三十 頁 863 注⑧` },
    { term: '偏轅', gloss: '讓車轅偏向一邊，只讓一個輪子著地。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 863 注⑪（系統作者依注文與語譯縮寫）` },
    { term: '石崇', gloss: '石崇（249–300），字季倫，西晉鉅富，以與王愷鬥富著名。', kind: 'proper_noun', source: '維基百科「石崇」 https://zh.wikipedia.org/wiki/石崇' },
    { term: '王愷', gloss: '王愷，字君夫，晉武帝的舅舅；以與石崇鬥富著名。', kind: 'proper_noun', source: '維基百科「王愷」 https://zh.wikipedia.org/wiki/王愷_(西晉)' },
  ],
  targets: [
    {
      id: 'TS5',
      text: '乃密貨崇帳下都督及御車人，問所以',
      languagePoint: '貨＝動詞（買通）；所以＝原因',
      // 三民本語譯 p. 863 「於是他暗中買通了石崇部下的都督和趕牛車的人，問是甚麼原因」
      explanation: '（草稿）白話：於是他暗中買通了石崇部下的都督和趕牛車的人，問是甚麼原因。',
      choice: {
        prompt: '「密貨崇帳下都督」的「貨」在這裡比較像哪一個？',
        options: ['貨物', '用財物收買', '運送'],
        answerIndex: 1,
        whyWrong: ['（草稿）後面接的是人，不是在說東西。', '', '（草稿）文中沒有在搬東西。'],
      },
      layer1: '這句省略了主語：是誰去「密貨」又「問所以」？請從前一句找線索。',
      layer2: '「貨」的對象是都督和御車人。暗中對這些人做「貨」，想從他們那裡得到什麼？',
      acceptableAnswers: ['收買', '買通', '賄賂'],
      draft: true,
      required: true,
    },
    {
      id: 'TS6',
      text: '唯豫作熟末，客至，作白粥以投之',
      languagePoint: '豫＝預先；之＝代詞',
      // 三民本語譯 p. 863 「但預先做好炒熟的豆粉，客人來到，煮好白粥把粉丟下去就好了」
      explanation: '（草稿）白話：但預先做好炒熟的豆粉，客人來到，煮好白粥把粉丟下去就好了。',
      choice: {
        prompt: '「作白粥以投之」的「之」在這裡比較像哪一個？',
        options: ['客人', '白粥', '豆'],
        answerIndex: 1,
        whyWrong: ['（草稿）客人不會被「投」。', '', '（草稿）豆末是被丟進去的東西，不是接收的一方。'],
      },
      layer1: '「熟末」是客人來了才做，還是事先做好的？哪一個字告訴你？',
      layer2: '「投之」：是把什麼丟進什麼裡面？請從「熟末」和「白粥」判斷。',
      acceptableAnswers: ['白粥', '粥'],
      draft: true,
      required: true,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Training passage 3 — 汰侈 6（王君夫有牛）                            */
/* ------------------------------------------------------------------ */

// Transcribed from 三民 p. 864. 張撝之 not yet collated for this entry.
const T6_TEXT =
  '王君夫有牛，名「八百里駮」，常瑩其蹄角。王武子語君夫：「我射不如卿，今指賭卿牛，以千萬對之。」君夫既恃手快，且謂駿物無有殺理，便相然可，令武子先射。武子一起便破的，卻據胡床，叱左右：「速探牛心來！」須臾炙至，一臠便去。';

export const T6_PASSAGE: Passage = {
  id: 'T6',
  title: '世說新語·汰侈 6（八百里駮）',
  displayTitle: '短文（五）',
  source: `${SANMIN} 汰侈第三十 頁 864（張撝之本待對校）`,
  verified: false,
  text: T6_TEXT,
  charCount: countChars(T6_TEXT),
  annotations: [
    { term: '王君夫', gloss: '即王愷。', kind: 'proper_noun', source: `${SANMIN} 汰侈第三十 頁 864 注①` },
    { term: '八百里駮', gloss: '牛名。駮：有大片花斑的馬或牛；八百里，言其快速，可日行八百里。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 864 注②` },
    { term: '王武子', gloss: '即王濟。', kind: 'proper_noun', source: `${SANMIN} 汰侈第三十 頁 864 注④` },
    { term: '胡床', gloss: '一種坐具（三民本語譯作「交椅」）。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 864 語譯` },
    { term: '臠', gloss: '切成塊狀的肉。', kind: 'rare_word', source: `${SANMIN} 汰侈第三十 頁 864 注⑨` },
  ],
  targets: [
    {
      id: 'TS7',
      text: '今指賭卿牛，以千萬對之',
      languagePoint: '以＝介詞（用）；之＝代詞',
      // 三民本語譯 p. 864 「現在指定賭您的牛，我用一千萬錢當賭注」
      explanation: '（草稿）白話：現在指定賭您的牛，我用一千萬錢當賭注。「以」是「用」。',
      choice: {
        prompt: '「以千萬對之」的「以」比較像哪一個意思？',
        options: ['用（某樣東西）', '因為', '來（做某件事）'],
        answerIndex: 0,
        whyWrong: ['', '（草稿）前後沒有在說原因。', '（草稿）「以」後面接的是「千萬」這筆錢，不是動作。'],
      },
      layer1: '這是王武子對君夫說的話。「卿」稱呼的是誰？他指定要賭什麼？',
      layer2: '「以千萬」是拿出來的東西，「對之」是拿它去和什麼相對？請回頭找「之」所代表的東西。',
      acceptableAnswers: ['用', '拿'],
      draft: true,
      required: true,
    },
    {
      id: 'TS8',
      text: '武子一起便破的',
      languagePoint: '一起＝一下子；的＝靶心',
      // 三民本語譯 p. 864 「武子一箭就正中目標」
      explanation: '（草稿）白話：武子一箭就正中目標。「一起」是一下子；「破的」是射中目標。',
      choice: {
        prompt: '「破的」的「的」在這裡比較像哪一個？',
        options: ['的（助詞）', '箭靶的中心', '目的、想法'],
        answerIndex: 1,
        whyWrong: ['（草稿）句末沒有接名詞，不是「……的」。', '', '（草稿）前文在比射箭，不是在說想法。'],
      },
      layer1: '前一句說「令武子先射」。「一起」說的是武子射了幾次？',
      layer2: '「破的」和射箭有關。射箭的人要打中的是什麼東西？',
      acceptableAnswers: ['靶', '目標', '靶心'],
      draft: true,
      required: true,
    },
  ],
};

/* ------------------------------------------------------------------ */
/* S1b baseline behaviour — 汰侈 11（彭城王有快牛）                      */
/* ------------------------------------------------------------------ */

const B11_TEXT =
  '彭城王有快牛，至愛惜之。王太尉與射，賭得之。彭城王曰：「君欲自乘，則不論；若欲噉者，當以二十肥者代之。既不廢噉，又存所愛。」王遂殺噉。';

export const B11_PASSAGE: Passage = {
  id: 'B11',
  title: '世說新語·汰侈 11（彭城王快牛）',
  displayTitle: '短文（二）',
  source: `張撝之《世說新語譯注》頁 427（v5 T1 後半）；三民本 頁 868 作「君欲自乘則不論」，無逗號`,
  verified: false,
  text: B11_TEXT,
  charCount: countChars(B11_TEXT),
  annotations: [
    { term: '彭城王', gloss: '彭城穆王司馬權。', kind: 'proper_noun', source: `${SANMIN} 汰侈第三十 頁 868 注①` },
    { term: '王太尉', gloss: '指王衍。', kind: 'proper_noun', source: `${SANMIN} 汰侈第三十 頁 868 注②` },
  ],
  targets: [],
};

/* ------------------------------------------------------------------ */
/* S5b / S5a post-tests — 儉嗇第二十九 (all transcribed from 三民)       */
/* ------------------------------------------------------------------ */

const J1_TEXT =
  '和嶠性至儉，家有好李，王武子求之，與不過數十。王武子因其上直，率將少年能食之者，持斧詣園，飽共噉畢，伐之，送一車枝與和公。問曰：「何如君李？」和既得，唯笑而已。';

export const J1_PASSAGE: Passage = {
  id: 'J1',
  title: '世說新語·儉嗇 1（和嶠李）',
  displayTitle: '短文（六）',
  source: `${SANMIN} 儉嗇第二十九 頁 853；${ZHANG} 頁 420 與之同（張本「啖」為簡體合併字）`,
  verified: false,
  text: J1_TEXT,
  charCount: countChars(J1_TEXT),
  annotations: [
    { term: '王武子', gloss: '即王濟，和嶠妻子的弟弟。', kind: 'proper_noun', source: `${SANMIN} 儉嗇第二十九 頁 853 注③` },
    { term: '上直', gloss: '到宮中值班。直，通「值」。', kind: 'rare_word', source: `${SANMIN} 儉嗇第二十九 頁 853 注④` },
  ],
  targets: [],
};

const J7_TEXT =
  '王丞相性儉節，帳下甘果盈溢，不散；涉春爛敗，都督白之，公令舍去，敕曰：「慎不可令大郎知！」';

export const J7_PASSAGE: Passage = {
  id: 'J7',
  title: '世說新語·儉嗇 7（王丞相甘果）',
  displayTitle: '短文（八）',
  // 張撝之 p. 421 作「王丞相儉節，帳下甘果，盈溢不散。涉春爛敗，都督白之，公令舍去，曰：」
  source: `${SANMIN} 儉嗇第二十九 頁 856；張撝之本異文：無「性」、「敕」`,
  verified: false,
  text: J7_TEXT,
  charCount: countChars(J7_TEXT),
  annotations: [
    { term: '王丞相', gloss: '指王導。', kind: 'proper_noun', source: `${SANMIN} 儉嗇第二十九 頁 856 注①` },
    { term: '都督', gloss: '官名。高級軍事長官。', kind: 'proper_noun', source: `${SANMIN} 儉嗇第二十九 頁 856 注⑤` },
    { term: '大郎', gloss: '指王導的長子王悅。', kind: 'proper_noun', source: `${SANMIN} 儉嗇第二十九 頁 856 注⑧` },
  ],
  targets: [],
};

const J9_TEXT =
  '郗公大聚斂，有錢數千萬；嘉賓意甚不同。常朝旦問訊，郗家法，子弟不坐；因倚語移時，遂及財貨事。郗公曰：「汝正當欲得吾錢耳！」迺開庫一日，令任意用。郗公始正謂損數百萬許；嘉賓遂一日乞與親友，都盡。郗公聞之，驚怪不能已已。';

export const J9_PASSAGE: Passage = {
  id: 'J9',
  title: '世說新語·儉嗇 9（郗公聚斂）',
  displayTitle: '短文（七）',
  // 張撝之 p. 422 作「嘉賓遂一日乞與親友、周旋略盡」
  source: `${SANMIN} 儉嗇第二十九 頁 857；張撝之本異文：「周旋略盡」（三民「都盡」）`,
  verified: false,
  text: J9_TEXT,
  charCount: countChars(J9_TEXT),
  annotations: [
    { term: '郗公', gloss: '指郗愔。', kind: 'proper_noun', source: `${SANMIN} 儉嗇第二十九 頁 857 注①` },
    { term: '嘉賓', gloss: '即郗超，郗愔的兒子。', kind: 'proper_noun', source: `${SANMIN} 儉嗇第二十九 頁 857 注②及語譯` },
  ],
  targets: [],
};

/** The three S2 training passages, in the order every reader sees them. */
export const TRAINING_PASSAGES: Passage[] = [LEARNING_PASSAGE, T5_PASSAGE, T6_PASSAGE];

export const PASSAGES: Record<string, Passage> = Object.fromEntries(
  [PRETEST_PASSAGE, B11_PASSAGE, ...TRAINING_PASSAGES, J1_PASSAGE, J9_PASSAGE, J7_PASSAGE].map(p => [p.id, p])
);

/** Every target sentence across the training passages (ids are unique across passages). */
export const ALL_TARGETS = TRAINING_PASSAGES.flatMap(p => p.targets);
