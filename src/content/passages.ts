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
 * - S6 uses an external, officially answered item set (澳門四高校聯合入學考試). Its passage
 *   text and items are NOT included here because they must come from the official PDF.
 */

const T2_TEXT =
  '武帝嘗降王武子家，武子供饌，並用瑠璃器。婢子百餘人，皆綾羅絝𧟌，以手擎飲食。烝㹠肥美，異於常味。帝怪而問之，答曰：「以人乳飲㹠。」帝甚不平，食未畢，便去。王、石所未知作。' +
  '石崇與王愷爭豪，並窮綺麗，以飾輿服。武帝，愷之甥也，每助愷。嘗以一珊瑚樹高二尺許賜愷，枝柯扶疏，世罕其比。愷以示崇，崇視訖，以鐵如意擊之，應手而碎。愷既惋惜，又以為疾己之寶，聲色甚厲。崇曰：「不足恨，今還卿。」乃命左右悉取珊瑚樹，有三尺、四尺，條幹絕世，光彩溢目者六七枚，如愷許比甚眾。愷惘然自失。';

const T1_TEXT =
  '石崇為客作豆粥，咄嗟便辦。恒冬天得韭蓱虀。又牛形狀氣力不勝王愷牛，而與愷出遊，極晚發，爭入洛城，崇牛數十步後迅若飛禽，愷牛絕走不能及。每以此三事為搤腕，乃密貨崇帳下都督及御車人，問所以。都督曰：「豆至難煮，唯豫作熟末，客至，作白粥以投之。韭蓱虀是搗韭根，雜以麥苗爾。」復問馭人牛所以駛，馭人云：「牛本不遲，由將車人不及制之爾。急時聽偏轅，則駛矣。」愷悉從之，遂爭長。石崇後聞，皆殺告者。' +
  '彭城王有快牛，至愛惜之。王太尉與射，賭得之。彭城王曰：「君欲自乘，則不論；若欲噉者，當以二十肥者代之。既不廢噉，又存所愛。」王遂殺噉。';

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
  displayTitle: '短文（二）',
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
      explanation: '（草稿）白話：用鐵如意敲它，珊瑚樹隨手就碎了。「以」是「用」；「之」指珊瑚樹，是「擊」的對象。',
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
      layer1: '觀察「之」前面的「擊」與「鐵如意」：兩者在句中的位置和角色有什麼不同？',
      layer1Choice: {
        options: ['一個動作（敲、打）', '一個東西（器物）', '一個形容的詞'],
        answerIndex: 0,
      },
      layer2: '比較「擊」前後的字詞：哪一處較可能承接這個動作？你根據什麼排列線索判斷？',
      layer2Choice: {
        options: ['在「擊」的前面', '在「擊」的後面', '這句話裡沒有寫出來'],
        answerIndex: 1,
      },
      acceptableAnswers: ['代詞', '代名詞', '指珊瑚樹', '被敲的東西', '它'],
      draft: true,
    },
    {
      id: 'TS2',
      text: '武帝，愷之甥也',
      languagePoint: '之＝助詞；判斷句',
      explanation: '（草稿）白話：晉武帝是王愷的外甥。「之」相當於「的」；「……也」表示判斷，說明兩人的關係。',
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
      explanation: '（草稿）白話：光彩奪目的珊瑚樹有六七株。「者」把「光彩溢目」接到被形容的珊瑚樹上。',
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
      explanation: '（草稿）白話：兩人都用盡最華麗的東西，來裝飾車馬和衣服。「以」相當於「來」，接著說目的。',
      choice: {
        prompt: '「以飾輿服」的「以」比較像哪一個意思？',
        options: ['用（某個工具）', '來（做某件事）', '因為'],
        answerIndex: 1,
        whyWrong: ['（草稿）作「用」時後面會接名詞，這裡後面是動作「飾」。', '', '（草稿）文中沒有在說原因。'],
      },
      layer1: '比較「飾」與「輿服」在「以」後面的排列：兩者在句中的角色有何不同？',
      layer1Choice: {
        options: ['一個動作（裝飾）', '一個東西（飾品）', '一個形容的詞'],
        answerIndex: 0,
      },
      layer2: '比較逗號前後兩段的動作與對象：你看到哪些線索讓它們接續起來？',
      layer2Choice: {
        options: ['前面是做法，後面是要達到的目的', '前面是原因，後面是結果', '兩件互不相干的事'],
        answerIndex: 0,
      },
      acceptableAnswers: ['來', '連詞', '用來'],
      draft: true,
    },
  ],
};

export const TRANSFER_PASSAGE: Passage = {
  id: 'T1',
  title: '世說新語·汰侈 5＋11（豆粥、彭城王快牛）',
  displayTitle: '短文（三）',
  source: '前半 劉義慶編撰、顏興林注釋《世說新語》（新北：布拉格文創社，2019 初版，ISBN 978-986-98221-2-1）汰侈第三十 頁 446–447；後半 張撝之《世說新語譯注》頁 427',
  verified: false,
  text: T1_TEXT,
  charCount: countChars(T1_TEXT),
  annotations: [], // transfer passage has NO annotations by design
  targets: [],
};

/**
 * S6 延宕測驗用篇章：《周書·卷四十一·王褒傳》節選。
 *
 * 取得方式：澳門四高校聯合入學考試（四校聯考）2024 年中文科「試題及參考答案」官方 PDF
 *   https://aecm.org.mo/wp-content/uploads/2024-試題及參考答案-中文.pdf
 *   （列於 https://aecm.org.mo/fmaecm/past-papers/ ）
 * 底本身份：《周書》為唐·令狐德棻等撰，屬公有領域；此處的節選範圍與斷句依官方試卷。
 *
 * 尚未完成的查核（故 verified: false）：
 *  1. 本段文字是經 PDF 轉文字取得，尚未逐字對照原卷版面。特別注意「左仆射」一處，
 *     澳門試卷用正體，原卷極可能作「左僕射」，需以人眼核對 PDF 後改正。
 *  2. 尚未與《周書》通行點校本（中華書局點校本）對校。本工作階段無法取用
 *     維基文庫與 ctext（前者在此環境不可擷取，後者禁止自動擷取）。
 *
 * 授權：S6-01..05 為官方試題原文，僅作學術研究之測驗工具使用，已標明出處。
 * 若日後要公開發表題目全文，需另行向澳門四高校聯合入學考試辦公室確認授權。
 */
const S6_TEXT =
  '王褒，字子淵，瑯邪臨沂人也。曾祖儉，齊侍中、太尉、南昌文憲公。祖騫，梁侍中、金紫光祿大夫、南昌安侯。父規，梁侍中、左民尚書、南昌章侯。並有重名於江左。' +
  '褒識量淹通，志懷沉靜，美風儀，善談笑，博覽史傳，尤工屬文。梁國子祭酒蕭子雲，褒之姑父也，特善草、隸。褒少以姻戚，去來其家，遂相模範，俄而名亞子雲，並見重於世。' +
  '梁武帝喜其才藝，遂以弟鄱陽王恢之女妻之。起家秘書郎，轉太子舍人，襲爵南昌縣侯，稍遷秘書丞。宣成王大器，簡文帝之冢嫡，即褒之姑子也。於時盛選僚佐，乃以褒為文學。' +
  '尋遷安成郡守。及侯景渡江，建業擾亂，褒輯寧所部，見稱於時。' +
  '梁元帝承制，轉智武將軍，南平內史。及嗣位於江陵，欲待褒以不次之位，褒時猶在郡，敕王僧辯以禮發遣，褒乃將家西上。元帝與褒有舊，相得甚歡。拜侍中，累遷禮部尚書、左仆射。' +
  '褒既世胄名家，文學優贍，當時咸相推挹，故旬月之間，位升端右，寵遇日隆。而褒愈自謙虛，不以位地矜人，時論稱之。';

export const DELAYED_PASSAGE: Passage = {
  id: 'S6',
  title: '周書·王褒傳（節選）',
  displayTitle: '短文（四）',
  source: '澳門四高校聯合入學考試 2024 中文科試卷（底本：《周書》卷四十一，唐·令狐德棻等撰）',
  verified: false,
  text: S6_TEXT,
  charCount: countChars(S6_TEXT),
  annotations: [], // 延宕測驗依設計不提供注解
  targets: [],
};

export const PASSAGES: Record<string, Passage> = {
  [PRETEST_PASSAGE.id]: PRETEST_PASSAGE,
  [LEARNING_PASSAGE.id]: LEARNING_PASSAGE,
  [TRANSFER_PASSAGE.id]: TRANSFER_PASSAGE,
  [DELAYED_PASSAGE.id]: DELAYED_PASSAGE,
};
