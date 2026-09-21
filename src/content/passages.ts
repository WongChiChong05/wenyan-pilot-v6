import type { Passage } from '../lib/types';

/**
 * 教材 (reading materials).
 *
 * SOURCE AND VERIFICATION STATUS
 * - The three passages below are 《世說新語·汰侈》 entries, transcribed from 維基文庫 with
 *   劉孝標注 removed. They are marked `verified: false`.
 *   They MUST be collated against 三民《新譯世說新語》 and 余嘉錫《世說新語箋疏》 before
 *   collection; flip `verified` to true only after that, and record the editions used.
 * - ANNOTATION GLOSSES (2026-09): each single-word gloss below is copied from a named
 *   dictionary and carries its `source`. Sources used:
 *     萌典 / 教育部《重編國語辭典修訂本》  https://www.moedict.tw/<詞>
 *     漢典 (for entries 教育部辭典 does not carry)  https://www.zdic.net/hans/<詞>
 *     法鼓文理學院 人名規範資料庫  https://authority.dila.edu.tw/person/
 *     維基百科 (proper nouns only)
 *   Where a gloss joins two dictionary entries into one compound (絝𧟌, 條榦, 鐵如意,
 *   烝㹠), the join is the system author's, not the dictionary's, and is marked 「合指」.
 *   A 中文系 reviewer must still sign these off before collection.
 * - Target-sentence explanations below are DRAFTS written by the system author, not taken
 *   from an annotated edition. Every entry marked `draft: true` must be replaced or
 *   confirmed. `npm run validate:content` fails while drafts remain.
 * - S6 uses an external, officially answered item set (澳門四高校聯合入學考試). Its passage
 *   text and items are NOT included here because they must come from the official PDF.
 */

const T2_TEXT =
  '武帝嘗降王武子家，武子供饌，並用瑠璃器。婢子百餘人，皆綾羅絝𧟌，以手擎飲食。烝㹠肥美，異於常味。帝怪而問之，答曰：「以人乳飲㹠。」帝甚不平，食未畢，便去。' +
  '石崇與王愷爭豪，並窮綺麗，以飾輿服。武帝，愷之甥也，每助愷。嘗以一珊瑚樹，高二尺許賜愷。枝柯扶疎，世罕其比。愷以示崇。崇視訖，以鐵如意擊之，應手而碎。愷既惋惜，又以為疾己之寶，聲色甚厲。崇曰：「不足恨，今還卿。」乃命左右悉取珊瑚樹，有三尺四尺，條榦絕世，光彩溢目者六七枚，如愷許比甚眾。愷惘然自失。';

const T1_TEXT =
  '石崇為客作豆粥，咄嗟便辦。恆冬天得韭蓱䪢。又牛形狀氣力不勝王愷牛，而與愷出遊，極晚發，爭入洛城，崇牛數十步後，迅若飛禽，愷牛絕走不能及。每以此三事為搤腕。乃密貨崇帳下都督及御車人，問所以。都督曰：「豆至難煮，唯豫作熟末，客至，作白粥以投之。韭蓱䪢是搗韭根，雜以麥苗爾。」復問馭人牛所以駛。馭人云：「牛本不遲，由將車人不及制之爾。急時聽偏轅，則駛矣。」愷悉從之，遂爭長。石崇後聞，皆殺告者。' +
  '彭城王有快牛，至愛惜之。王太尉與射，賭得之。彭城王曰：「君欲自乘則不論；若欲噉者，當以二十肥者代之。既不廢噉，又存所愛。」王遂殺噉。';

const PRETEST_TEXT =
  '石崇廁，常有十餘婢侍列，皆麗服藻飾。置甲煎粉、沈香汁之屬，無不畢備。又與新衣著令出，客多羞不能如廁。王大將軍往，脫故衣，著新衣，神色傲然。羣婢相謂曰：「此客必能作賊。」';

const countChars = (s: string) => s.replace(/[^一-鿿]/g, '').length;

export const PRETEST_PASSAGE: Passage = {
  id: 'P0',
  title: '世說新語·汰侈 2（石崇廁）',
  displayTitle: '短文（一）',
  source: '維基文庫（待以注譯本核校）',
  verified: false,
  text: PRETEST_TEXT,
  charCount: countChars(PRETEST_TEXT),
  annotations: [
    {
      term: '甲煎粉',
      gloss: '甲煎：古代香料，以甲香調合沉香、麝香等製成，可作口脂、薰香或入藥。甲煎粉即這種香粉。',
      kind: 'rare_word',
      source: '漢典 https://www.zdic.net/hans/甲煎（教育部《重編國語辭典修訂本》無此條）',
    },
    {
      term: '沈香汁',
      gloss: '沈香同「沉香」：瑞香科香木，木質沉重有香氣，可作薰香料及藥材。合指沈香製成的香汁。',
      kind: 'rare_word',
      source: '萌典/教育部辭典「沉香」 https://www.moedict.tw/沉香；漢典「沈香」 https://www.zdic.net/hans/沈香',
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
  source: '維基文庫（待以注譯本核校）',
  verified: false,
  text: T2_TEXT,
  charCount: countChars(T2_TEXT),
  annotations: [
    {
      term: '瑠璃器',
      gloss: '瑠璃同「琉璃」：青色的寶石，或指燒製的琉璃料。合指琉璃製的器皿。',
      kind: 'rare_word',
      source: '萌典/教育部辭典「琉璃」 https://www.moedict.tw/琉璃',
    },
    {
      term: '綾羅絝𧟌',
      gloss: '綾羅：細緻柔軟而有光彩的絲織品。絝：「褲」的異體字。𧟌（ㄌㄨㄛˋ）：古代婦女的上衣。合指絲質的衣褲。',
      kind: 'rare_word',
      source:
        '萌典「綾羅」 https://www.moedict.tw/綾羅；萌典「絝」 https://www.moedict.tw/絝；漢典「𧟌」 https://www.zdic.net/hans/%F0%A7%9F%8C',
    },
    {
      term: '烝㹠',
      gloss: '烝：用熱水氣蒸東西。㹠：「豚」的異體字，小豬。合指蒸乳豬。',
      kind: 'rare_word',
      source: '萌典「烝」 https://www.moedict.tw/烝；萌典「㹠」 https://www.moedict.tw/㹠',
    },
    {
      term: '扶疎',
      gloss: '同「扶疏」：枝葉茂盛分披的樣子。',
      kind: 'rare_word',
      source: '萌典/教育部辭典「扶疏」 https://www.moedict.tw/扶疏',
    },
    {
      term: '條榦',
      gloss: '榦（ㄍㄢˋ）：事物的主體，此指樹幹。合指珊瑚樹的枝與幹。',
      kind: 'rare_word',
      source: '萌典「榦」 https://www.moedict.tw/榦',
    },
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
      explanation: '（草稿）「之」是代詞，指珊瑚樹，接在動作「擊」後面，是被敲的對象。',
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
      layer1: '先看這一句裡的「之」。它前面緊接著的「擊」，是一個動作還是一個東西？',
      layer1Choice: {
        options: ['一個動作（敲、打）', '一個東西（器物）', '一個形容的詞'],
        answerIndex: 0,
      },
      layer2: '「擊」是一個動作。那麼「被敲的東西」在這句話裡出現在哪裡？',
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
      explanation: '（草稿）這裡的「之」相當於白話的「的」，「愷之甥」就是王愷的外甥。',
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
      layer1: '先看這一句裡的「之」。它的前面是「愷」，後面是「甥」，這兩個都是什麼詞？',
      layer1Choice: {
        options: ['都是人或身分（名詞）', '都是動作', '一個是動作，一個是名詞'],
        answerIndex: 0,
      },
      layer2: '「愷」和「甥」都是名詞。夾在兩個名詞中間的字，通常在做什麼？',
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
      explanation: '（草稿）「者」把形容的話「光彩溢目」和被形容的珊瑚樹連起來，數的是珊瑚樹。',
      choice: {
        prompt: '「光彩溢目者六七枚」說的是什麼有六七枚？',
        options: ['光彩', '珊瑚樹', '眼睛'],
        answerIndex: 1,
        whyWrong: ['（草稿）光彩不能用「枚」計算。', '', '（草稿）文中沒有在數眼睛。'],
      },
      layer1: '先看這一句裡的「者」。它前面的「光彩溢目」，是在描述一個東西的樣子，還是在說一個動作？',
      layer1Choice: {
        options: ['描述一個東西的樣子', '說一個動作', '說一個時間'],
        answerIndex: 0,
      },
      // 層二問「者」的功能，層三才問它指的是什麼，兩層不重複。
      layer2: '那麼「者」這個字在這裡的作用，比較像下面哪一種？',
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
      explanation: '（草稿）這裡的「以」相當於白話的「來」：極盡華麗，來裝飾車馬衣服。',
      choice: {
        prompt: '「以飾輿服」的「以」比較像哪一個意思？',
        options: ['用（某個工具）', '來（做某件事）', '因為'],
        answerIndex: 1,
        whyWrong: ['（草稿）作「用」時後面會接名詞，這裡後面是動作「飾」。', '', '（草稿）文中沒有在說原因。'],
      },
      layer1: '先看這一句裡的「以」。它後面緊接著的「飾」，是一個東西還是一個動作？',
      layer1Choice: {
        options: ['一個動作（裝飾）', '一個東西（飾品）', '一個形容的詞'],
        answerIndex: 0,
      },
      layer2: '「飾輿服」和前面的「並窮綺麗」是什麼關係？',
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
  source: '維基文庫（待以注譯本核校）',
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
