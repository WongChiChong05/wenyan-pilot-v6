import type { Passage } from '@/lib/types';

/**
 * 教材 (reading materials).
 *
 * SOURCE AND VERIFICATION STATUS
 * - The three passages below are 《世說新語·汰侈》 entries, transcribed from 維基文庫 with
 *   劉孝標注 removed. They are marked `verified: false`.
 *   They MUST be collated against 三民《新譯世說新語》 and 余嘉錫《世說新語箋疏》 before
 *   collection; flip `verified` to true only after that, and record the editions used.
 * - Annotations and target-sentence explanations below are DRAFTS written by the system
 *   author, not taken from an annotated edition. Every entry marked `draft: true` must be
 *   replaced or confirmed. `npm run validate:content` fails while drafts remain.
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
  source: '維基文庫（待以注譯本核校）',
  verified: false,
  text: PRETEST_TEXT,
  charCount: countChars(PRETEST_TEXT),
  annotations: [
    { term: '甲煎粉', gloss: '（待填：香料製成的粉）', kind: 'rare_word' },
    { term: '沈香汁', gloss: '（待填）', kind: 'rare_word' },
    { term: '王大將軍', gloss: '（待填：王敦）', kind: 'proper_noun' },
  ],
  targets: [],
};

export const LEARNING_PASSAGE: Passage = {
  id: 'T2',
  title: '世說新語·汰侈 3＋8（人乳飲㹠、珊瑚樹）',
  source: '維基文庫（待以注譯本核校）',
  verified: false,
  text: T2_TEXT,
  charCount: countChars(T2_TEXT),
  annotations: [
    { term: '瑠璃器', gloss: '（待填）', kind: 'rare_word' },
    { term: '綾羅絝𧟌', gloss: '（待填）', kind: 'rare_word' },
    { term: '烝㹠', gloss: '（待填）', kind: 'rare_word' },
    { term: '扶疎', gloss: '（待填）', kind: 'rare_word' },
    { term: '條榦', gloss: '（待填）', kind: 'rare_word' },
    { term: '鐵如意', gloss: '（待填）', kind: 'rare_word' },
    { term: '武帝', gloss: '（待填：晉武帝司馬炎）', kind: 'proper_noun' },
    { term: '王武子', gloss: '（待填）', kind: 'proper_noun' },
    { term: '石崇', gloss: '（待填）', kind: 'proper_noun' },
    { term: '王愷', gloss: '（待填）', kind: 'proper_noun' },
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
      layer1: '這個字在句子什麼位置？前後是什麼詞性？',
      layer2: '前面的「擊」是一個動作。被敲的東西出現在句子的哪裡？',
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
      layer1: '這個字在句子什麼位置？前後是什麼詞性？',
      layer2: '「愷」和「甥」都是名詞。夾在兩個名詞中間的字，通常在做什麼？',
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
      layer1: '這個字在句子什麼位置？前後是什麼詞性？',
      layer2: '「六七枚」在數什麼？往前找，被數的東西是哪一個詞？',
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
      layer1: '這個字在句子什麼位置？前後是什麼詞性？',
      layer2: '「以」後面接的是名詞還是動作？跟前面那句是什麼關係？',
      acceptableAnswers: ['來', '連詞', '用來'],
      draft: true,
    },
  ],
};

export const TRANSFER_PASSAGE: Passage = {
  id: 'T1',
  title: '世說新語·汰侈 5＋11（豆粥、彭城王快牛）',
  source: '維基文庫（待以注譯本核校）',
  verified: false,
  text: T1_TEXT,
  charCount: countChars(T1_TEXT),
  annotations: [], // transfer passage has NO annotations by design
  targets: [],
};

/** S6: supplied by the researcher from the official paper. Empty until then. */
export const DELAYED_PASSAGE: Passage = {
  id: 'S6',
  title: '（待填：澳門四高校聯合入學考試 2024《周書·王褒傳》節選）',
  source: '（待填：官方試題 PDF）',
  verified: false,
  text: '',
  charCount: 0,
  annotations: [],
  targets: [],
};

export const PASSAGES: Record<string, Passage> = {
  [PRETEST_PASSAGE.id]: PRETEST_PASSAGE,
  [LEARNING_PASSAGE.id]: LEARNING_PASSAGE,
  [TRANSFER_PASSAGE.id]: TRANSFER_PASSAGE,
  [DELAYED_PASSAGE.id]: DELAYED_PASSAGE,
};
