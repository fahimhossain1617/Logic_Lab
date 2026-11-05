import { ExecutionTrace, SampleProgram, SupportedLanguage, ExplainLanguage, ExplanationDepth } from '../../shared/types';

const SWAP_CORRECT_BN_SIMPLE: ExecutionTrace = {
  isValidLogic: true,
  errorDetails: null,
  language: 'javascript',
  analogyType: 'swap_buckets',
  traceSource: 'builtin_verified',
  logicSummary: {
    title: 'দুটি ভ্যারিয়েবলের মান অদলবদল (Swap with temp)',
    goal: '`a` এবং `b` এর মান নিজেদের মধ্যে অদলবদল করা।',
    idea: 'একটি কাপ থেকে অন্য কাপে সরাসরি ঢাললে পুরনো তরল হারিয়ে যায়, তাই মাঝখানে একটি খালি কাপ (`temp`) ব্যবহার করা হয়।',
    keyPoints: [
      'প্রথমে `a`-র মান `temp` কাপে নিরাপদে কপি করে রাখা হয়',
      'এরপর `a` কাপে `b`-র মান বসানো হয়',
      'সবশেষে `b` কাপে `temp`-এ রাখা পুরনো `a`-র মান ঢেলে দেওয়া হয়',
    ],
    analogyStory: 'দুটি গ্লাসের শরবত অদলবদল করতে চাইলে তৃতীয় একটি খালি গ্লাস (`temp`) লাগে, যাতে কোনো শরবত উপচে নষ্ট না হয়।',
    complexity: {
      time: 'O(1)',
      space: 'O(1)',
      note: 'মাত্র তিনটি নির্দিষ্ট ধাপ লাগে, তাই সংখ্যা যত বড়ই হোক সময় একই থাকে।',
    },
    commonMistakes: [
      '`temp` ছাড়া সরাসরি `a = b; b = a;` লিখলে `a`-র আসল মান চিরতরে হারিয়ে যায়',
      '`temp = b` আগে লিখে ফেলা বা ভুল ক্রমে মান বসানো',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: '`a` নামে একটি নতুন কাপ নেওয়া হলো এবং তাতে `5` রাখা হলো।' },
    { line: 2, role: 'declare', text: '`b` নামে আরেকটি কাপ নেওয়া হলো এবং তাতে `10` রাখা হলো।' },
    { line: 3, role: 'assign', text: '`temp` নামে একটি নতুন খালি কাপ নেওয়া হলো এবং `a`-র মান (`5`) এর একটি কপি তাতে রাখা হলো। এখন `5` নিরাপদে `temp`-এ জমা আছে।' },
    { line: 4, role: 'assign', text: '`a` কাপের পুরনো মান সরিয়ে `b` কাপের মান (`10`) বসানো হলো। আগের `5` হারায়নি, কারণ সেটা `temp`-এ আছে।' },
    { line: 5, role: 'assign', text: '`b` কাপে `temp` কাপের সংরক্ষিত মান (`5`) ঢেলে দেওয়া হলো। অদলবদল সম্পূর্ণ!' },
    { line: 6, role: 'output', text: 'পর্দায় নতুন মান `a: 10 b: 5` প্রিন্ট করা হলো।' },
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: 'swap_buckets',
      action: 'declare',
      from: null,
      to: 'a',
      explanation: '`a` কাপে `5` মানটি রাখা হলো।',
      why: 'প্রথম ভ্যারিয়েবল (variable) তৈরি করে তার প্রাথমিক মান সেট করা দরকার।',
      changes: [{ name: 'a', from: null, to: 5 }],
      variables: { a: 5 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 2,
      activeLine: 2,
      analogyType: 'swap_buckets',
      action: 'declare',
      from: null,
      to: 'b',
      explanation: '`b` কাপে `10` মানটি রাখা হলো।',
      why: 'দ্বিতীয় ভ্যারিয়েবল তৈরি করে তার প্রাথমিক মান সেট করা হলো।',
      changes: [{ name: 'b', from: null, to: 10 }],
      variables: { a: 5, b: 10 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 3,
      activeLine: 3,
      analogyType: 'swap_buckets',
      action: 'transfer',
      from: 'a',
      to: 'temp',
      explanation: '`temp` নামে নতুন কাপে `a`-র মান (`5`) এর একটি কপি রাখা হলো।',
      why: 'পরের লাইনে `a`-র মান বদলে যাবে, তাই পুরনো `5` বাঁচিয়ে রাখতে `temp` ব্যবহার করা হলো।',
      changes: [{ name: 'temp', from: null, to: 5 }],
      variables: { a: 5, b: 10, temp: 5 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 4,
      activeLine: 4,
      analogyType: 'swap_buckets',
      action: 'transfer',
      from: 'b',
      to: 'a',
      explanation: '`b` কাপের মান (`10`) কপি করে `a` কাপে বসানো হলো।',
      why: '`a`-তে এখন `b`-র মান দরকার; আর `a`-র পুরনো `5` তো `temp`-এ সুরক্ষিত আছেই।',
      changes: [{ name: 'a', from: 5, to: 10 }],
      variables: { a: 10, b: 10, temp: 5 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 5,
      activeLine: 5,
      analogyType: 'swap_buckets',
      action: 'transfer',
      from: 'temp',
      to: 'b',
      explanation: '`temp` কাপ থেকে সংরক্ষিত `5` মানটি `b` কাপে রাখা হলো।',
      why: '`b`-তে `a`-র আদি মান (`5`) বসানোর মাধ্যমে সোয়াপ (swap) কাজটি শেষ হলো।',
      changes: [{ name: 'b', from: 10, to: 5 }],
      variables: { a: 10, b: 5, temp: 5 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 6,
      activeLine: 6,
      analogyType: 'swap_buckets',
      action: 'declare',
      from: null,
      to: null,
      explanation: 'চূড়ান্ত ফলাফল `a: 10 b: 5` আউটপুটে দেখানো হলো।',
      why: 'অদলবদল ঠিকমতো কাজ করেছে কি না তা যাচাই করার জন্য প্রিন্ট করা হলো।',
      changes: [],
      variables: { a: 10, b: 5, temp: 5 },
      fault: null,
      structure: null,
    },
  ],
  finalOutput: 'a: 10 b: 5',
  outputExplanation: 'প্রোগ্রাম শেষে `a`-তে `10` আর `b`-তে `5` আছে, কারণ ৩ নম্বর লাইনে `temp`-এ `5` বাঁচিয়ে রাখা হয়েছিল, ৪ নম্বর লাইনে `a` পেয়েছে `b`-র মান (`10`), আর ৫ নম্বর লাইনে `b` পেয়েছে `temp`-এ রাখা পুরনো `a`-র মান (`5`)।',
  verdict: {
    status: 'ok',
    message: 'অদলবদল (Swap) সফলভাবে সম্পন্ন হয়েছে।',
  },
};

const SWAP_CORRECT_EN_SIMPLE: ExecutionTrace = {
  ...SWAP_CORRECT_BN_SIMPLE,
  logicSummary: {
    title: 'Swapping Two Variables with Temp',
    goal: 'Exchange the values stored inside `a` and `b`.',
    idea: 'Pouring directly from one full cup into another overwrites the old liquid, so we use an empty third cup (`temp`) to hold the original value safely.',
    keyPoints: [
      'Save the original value of `a` inside `temp` first',
      'Copy the value of `b` into `a`',
      'Copy the saved value from `temp` into `b`',
    ],
    analogyStory: 'To swap juice between two full glasses without spilling, you pour one glass into a spare empty glass (`temp`) first.',
    complexity: {
      time: 'O(1)',
      space: 'O(1)',
      note: 'Always takes exactly 3 assignment operations regardless of value size.',
    },
    commonMistakes: [
      'Writing `a = b; b = a;` without `temp` overwrites `a` and loses `5` forever',
      'Overwriting `temp` before copying `a` into it',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: 'Create cup `a` and fill it with value `5`.' },
    { line: 2, role: 'declare', text: 'Create cup `b` and fill it with value `10`.' },
    { line: 3, role: 'assign', text: 'Create a spare cup `temp` and copy `a` (`5`) into it so `5` is safely backed up.' },
    { line: 4, role: 'assign', text: 'Replace `a` with `b` (`10`). The original `5` is safe inside `temp`.' },
    { line: 5, role: 'assign', text: 'Pour the saved `5` from `temp` into `b`. The swap is complete!' },
    { line: 6, role: 'output', text: 'Print the final swapped result `a: 10 b: 5`.' },
  ],
  steps: SWAP_CORRECT_BN_SIMPLE.steps.map((s, idx) => {
    const enExplanations = [
      { explanation: 'Cup `a` is created and filled with `5`.', why: 'Initialize the first variable before swapping.' },
      { explanation: 'Cup `b` is created and filled with `10`.', why: 'Initialize the second variable before swapping.' },
      { explanation: 'Copy `a` (`5`) into the spare cup `temp`.', why: 'Line 4 will overwrite `a`, so we must preserve `5` in `temp` first.' },
      { explanation: 'Copy `b` (`10`) into cup `a`.', why: '`a` now receives `b`\'s value while `5` remains safe inside `temp`.' },
      { explanation: 'Copy `temp` (`5`) into cup `b`.', why: 'Complete the swap by giving `b` the saved original value of `a`.' },
      { explanation: 'Print `a: 10 b: 5` to the output terminal.', why: 'Display the verified swapped values.' },
    ];
    return {
      ...s,
      explanation: enExplanations[idx].explanation,
      why: enExplanations[idx].why,
    };
  }),
  outputExplanation: 'At the end of the program `a` holds `10` and `b` holds `5` because line 3 backed up `5` in `temp`, line 4 copied `10` into `a`, and line 5 restored `5` from `temp` into `b`.',
  verdict: {
    status: 'ok',
    message: 'Swap completed cleanly with zero data loss.',
  },
};

const SWAP_FAULTY_BN_SIMPLE: ExecutionTrace = {
  isValidLogic: false,
  errorDetails: {
    line: 3,
    message: '৫ (5) মানটি হারিয়ে গেছে কারণ temp ছাড়াই a-তে b-এর মান বসানো হয়েছে।',
  },
  language: 'javascript',
  analogyType: 'swap_buckets',
  traceSource: 'builtin_verified',
  logicSummary: {
    title: 'ভুল সোয়াপ: temp ছাড়া মান হারানো (Lost Value Fault)',
    goal: '`a` এবং `b` এর মান বদলানোর চেষ্টা করা হয়েছে, কিন্তু লজিকে ভুল আছে।',
    idea: 'খালি কাপ (`temp`) ছাড়া সরাসরি `a = b` লিখলে `a` কাপের পুরনো তরল (`5`) উপচে পড়ে চিরতরে হারিয়ে যায়।',
    keyPoints: [
      '৩ নম্বর লাইনে `a = b` লেখার সাথে সাথে `a`-র আগের মান `5` মুছে `10` হয়ে যায়',
      '৪ নম্বর লাইনে `b = a` লেখার সময় `a`-তেও `10` আছে, তাই `b`-তেও `10` বসে',
      'ফলে দুটি ভ্যারিয়েবলেই `10` থেকে যায় এবং `5` চিরতরে হারিয়ে যায়',
    ],
    analogyStory: 'ভরা গ্লাসে সরাসরি আরেক গ্লাসের পানি ঢাললে আগের পানি মেঝেতে উপচে পড়ে নষ্ট হয়ে যায়।',
    complexity: {
      time: 'O(1)',
      space: 'O(1)',
      note: 'ধাপ কম হলেও এটি ভুল আউটপুট দেয় কারণ ডেটা হারিয়ে যায়।',
    },
    commonMistakes: [
      'কখনোই `temp` ছাড়া `a = b; b = a;` লিখে সোয়াপ করা যাবে না',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: '`a` কাপে `5` রাখা হলো।' },
    { line: 2, role: 'declare', text: '`b` কাপে `10` রাখা হলো।' },
    { line: 3, role: 'assign', text: 'সতর্কতা! `a`-র মান কোথাও না রেখেই সরাসরি `a = b` লেখা হয়েছে — ফলে `5` উপচে পড়ে হারিয়ে গেল!' },
    { line: 4, role: 'assign', text: '`b = a` দেওয়া হলো, কিন্তু `a`-তে তো আগেই `10` বসে গেছে! তাই `b`-ও `10` পেল।' },
    { line: 5, role: 'output', text: 'ভুল আউটপুট `a: 10 b: 10` প্রিন্ট হলো (`5` হারিয়ে গেছে)।' },
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: 'swap_buckets',
      action: 'declare',
      from: null,
      to: 'a',
      explanation: '`a` কাপে `5` রাখা হলো।',
      why: 'প্রথম ভ্যারিয়েবল `a` শুরু করা হলো।',
      changes: [{ name: 'a', from: null, to: 5 }],
      variables: { a: 5 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 2,
      activeLine: 2,
      analogyType: 'swap_buckets',
      action: 'declare',
      from: null,
      to: 'b',
      explanation: '`b` কাপে `10` রাখা হলো।',
      why: 'দ্বিতীয় ভ্যারিয়েবল `b` শুরু করা হলো।',
      changes: [{ name: 'b', from: null, to: 10 }],
      variables: { a: 5, b: 10 },
      fault: null,
      structure: null,
    },
    {
      stepIndex: 3,
      activeLine: 3,
      analogyType: 'swap_buckets',
      action: 'halt',
      from: 'b',
      to: 'a',
      explanation: '`a = b` চালানোর ফলে `a` কাপের `5` উপচে পড়ে নষ্ট হয়ে গেল এবং তার জায়গায় `10` বসে গেল!',
      why: '`a`-র পুরনো মান `5` কোনো `temp` কাপে সংরক্ষণ না করেই নতুন মান ঢালা হয়েছে।',
      changes: [{ name: 'a', from: 5, to: 10 }],
      variables: { a: 10, b: 10 },
      fault: {
        type: 'lost_value',
        message: '5 হারিয়ে গেছে, কারণ a = b লেখার আগে a-র মান কোথাও রাখা হয়নি।',
        fixHint: 'a = b এর আগে let temp = a; লিখুন এবং শেষে b = temp; দিন।',
        target: 'a',
        lostValue: 5,
      },
      structure: null,
    },
  ],
  finalOutput: 'a: 10 b: 10',
  outputExplanation: 'প্রোগ্রাম শেষে `a` এবং `b` দুটোতেই `10` দেখাচ্ছে কারণ ৩ নম্বর লাইনে `a = b` লেখার ফলে `a`-র আদি মান `5` মুছে গিয়েছিল।',
  verdict: {
    status: 'logic_error',
    message: 'লজিক ভুল: 5 মানটি হারিয়ে গেছে (Lost Value Fault)।',
  },
};

const SWAP_FAULTY_EN_SIMPLE: ExecutionTrace = {
  ...SWAP_FAULTY_BN_SIMPLE,
  errorDetails: {
    line: 3,
    message: 'Value 5 was overwritten and lost because no temp variable was used before a = b.',
  },
  logicSummary: {
    title: 'Broken Swap: Overwriting Without Temp',
    goal: 'Attempt to swap `a` and `b` directly without a temporary variable.',
    idea: 'Pouring `b` directly into `a` spills the original liquid (`5`) out of cup `a` forever.',
    keyPoints: [
      'Line 3 (`a = b`) overwrites `a` (`5`) with `10` immediately',
      'The original value `5` is not stored anywhere in memory',
      'Both `a` and `b` end up holding `10`',
    ],
    analogyStory: 'Pouring a full cup of orange juice into a full cup of water spills the water onto the floor.',
    complexity: {
      time: 'O(1)',
      space: 'O(1)',
      note: 'Executes in constant time, but produces an incorrect result due to data loss.',
    },
    commonMistakes: [
      'Assigning `a = b` before saving `a` into `temp`',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: 'Create cup `a` with value `5`.' },
    { line: 2, role: 'declare', text: 'Create cup `b` with value `10`.' },
    { line: 3, role: 'assign', text: 'FAULT! `a = b` overwrites `5` with `10` without saving `5` first — `5` splashes out and is lost!' },
    { line: 4, role: 'assign', text: '`b = a` copies `10` into `b` because `a` is already `10`.' },
    { line: 5, role: 'output', text: 'Outputs wrong result `a: 10 b: 10` (`5` was lost).' },
  ],
  steps: [
    {
      ...SWAP_FAULTY_BN_SIMPLE.steps[0],
      explanation: 'Create cup `a` with initial value `5`.',
      why: 'Set up the first variable.',
    },
    {
      ...SWAP_FAULTY_BN_SIMPLE.steps[1],
      explanation: 'Create cup `b` with initial value `10`.',
      why: 'Set up the second variable.',
    },
    {
      ...SWAP_FAULTY_BN_SIMPLE.steps[2],
      explanation: 'Executing `a = b` overwrites cup `a` (`5`) with `10` — `5` splashes out and is lost forever!',
      why: 'No `temp` variable held `a`\'s original value before assignment.',
      fault: {
        type: 'lost_value',
        message: 'Value 5 was lost because `a` was overwritten before saving its value.',
        fixHint: 'Write `let temp = a;` before `a = b;`, then set `b = temp;`.',
        target: 'a',
        lostValue: 5,
      },
    },
  ],
  outputExplanation: 'Both `a` and `b` print `10` because line 3 destroyed `5` before line 4 could copy it into `b`.',
  verdict: {
    status: 'logic_error',
    message: 'Logic Fault: Value 5 was overwritten and lost.',
  },
};

const BUBBLE_SORT_BN_SIMPLE: ExecutionTrace = {
  isValidLogic: true,
  errorDetails: null,
  language: 'javascript',
  analogyType: 'sort_blocks',
  traceSource: 'builtin_verified',
  logicSummary: {
    title: 'বাবল সর্ট (Bubble Sort) — ছোট থেকে বড় সাজানো',
    goal: '`[5, 2, 8, 1, 4]` অ্যারেটিকে ছোট থেকে বড় ক্রমে `[1, 2, 4, 5, 8]` হিসেবে সাজানো।',
    idea: 'পাশাপাশি দুটি ব্লকের উচ্চতা তুলনা (compare) করে বাম পাশের ব্লকটি বড় হলে তাদের জায়গা অদলবদল (swap) করা হয়। প্রতি পাসে সবচেয়ে বড় ব্লকটি ডান প্রান্তে গিয়ে নিজের স্থায়ী জায়গায় বসে।',
    keyPoints: [
      'পাশাপাশি দুটি ব্লক `arr[j]` এবং `arr[j+1]` তুলনা করা হয়',
      'বাম ব্লকটি বড় হলে (`arr[j] > arr[j+1]`) তারা বাঁকা পথে জায়গা বদল করে',
      'প্রতিটি পূর্ণ ধাপ শেষে ডানদিকের একটি করে ব্লক সবুজ (sorted) হয়ে স্থির হয়ে যায়',
    ],
    analogyStory: 'পানির নিচ থেকে বড় বুদবুদ যেমন সবার আগে উপরে ভেসে ওঠে, তেমনি সবচেয়ে বড় সংখ্যার ব্লকটি প্রতি ধাপে ডান প্রান্তে চলে যায়।',
    complexity: {
      time: 'O(n²)',
      space: 'O(1)',
      note: 'প্রতিটি উপাদানের জন্য ভেতরের লুপ আবার চলে, কিন্তু নতুন কোনো অতিরিক্ত অ্যারে লাগে না।',
    },
    commonMistakes: [
      'ভেতরের লুপে `n - 1 - i` এর বদলে `n` পর্যন্ত চালালে `arr[j+1]` অ্যারের বাইরে চলে যায় (Index Out of Bounds)',
      'সোয়াপ করার সময় `temp` না ব্যবহার করা',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: '`arr` নামের অ্যারেতে (array) `[5, 2, 8, 1, 4]` এই ৫টি ব্লক সাজানো হলো।' },
    { line: 2, role: 'loop', text: 'বাইরের লুপ (outer loop): মোট কয়টি পাস (pass) চলবে তা `i` দিয়ে গোনা হচ্ছে।' },
    { line: 3, role: 'loop', text: 'ভেতরের লুপ (inner loop): `j` পয়েন্টার বাম দিক থেকে পাশাপাশি দুটি ব্লক পরীক্ষা করছে।' },
    { line: 4, role: 'condition', text: 'তুলনা: বাম ব্লক `arr[j]` কি ডান ব্লক `arr[j+1]` এর চেয়ে বড়?' },
    { line: 5, role: 'assign', text: 'হ্যাঁ বড়! তাই `arr[j]` এবং `arr[j+1]` ব্লক দুটি নিজেদের জায়গা অদলবদল (swap) করল।' },
    { line: 6, role: 'block_end', text: 'তুলনা ও অদলবদলের শর্ত শেষ।' },
    { line: 7, role: 'block_end', text: 'ভেতরের লুপের এক পাস শেষ; সবচেয়ে বড় ব্লকটি ডান প্রান্তে স্থায়ী হলো।' },
    { line: 8, role: 'output', text: 'সাজানো অ্যারে `[1, 2, 4, 5, 8]` প্রিন্ট করা হলো।' },
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: 'sort_blocks',
      action: 'declare',
      explanation: '`arr` অ্যারেতে `[5, 2, 8, 1, 4]` মানের ৫টি ব্লক তৈরি করা হলো।',
      why: 'সাজানোর জন্য অগোছালো সংখ্যাগুলো মেমোরিতে নেওয়া হলো।',
      changes: [{ name: 'arr', from: null, to: '[5, 2, 8, 1, 4]' }],
      variables: { arr: [5, 2, 8, 1, 4], i: 0, j: 0 },
      fault: null,
      structure: { kind: 'array', values: [5, 2, 8, 1, 4], highlight: [], sortedFrom: 5, pointers: { i: 0, j: 0 } },
    },
    {
      stepIndex: 2,
      activeLine: 4,
      analogyType: 'sort_blocks',
      action: 'compare',
      explanation: 'প্রথম দুটি ব্লক `5` এবং `2` তুলনা করা হচ্ছে (`5 > 2` সত্য)।',
      why: 'বাম দিকের `5` ব্লকটি ডান দিকের `2` এর চেয়ে বড় কি না তা দেখা হচ্ছে।',
      changes: [],
      variables: { arr: [5, 2, 8, 1, 4], i: 0, j: 0 },
      fault: null,
      structure: { kind: 'array', values: [5, 2, 8, 1, 4], highlight: [0, 1], sortedFrom: 5, pointers: { i: 0, j: 0 } },
    },
    {
      stepIndex: 3,
      activeLine: 5,
      analogyType: 'sort_blocks',
      action: 'swap',
      explanation: '`5` এবং `2` ব্লক দুটি বাঁকা পথে নিজেদের জায়গা বদল করল।',
      why: 'ছোট সংখ্যা `2`-কে বামে এবং বড় সংখ্যা `5`-কে ডানে পাঠানো হলো।',
      changes: [{ name: 'arr[0..1]', from: '5, 2', to: '2, 5' }],
      variables: { arr: [2, 5, 8, 1, 4], i: 0, j: 0 },
      fault: null,
      structure: { kind: 'array', values: [2, 5, 8, 1, 4], highlight: [0, 1], swapping: [0, 1], sortedFrom: 5, pointers: { i: 0, j: 0 } },
    },
    {
      stepIndex: 4,
      activeLine: 4,
      analogyType: 'sort_blocks',
      action: 'compare',
      explanation: '`j = 1`: এবার `5` এবং `8` তুলনা করা হচ্ছে (`5 > 8` মিথ্যা)।',
      why: '`5` আগেই `8` এর চেয়ে ছোট, তাই এখানে সোয়াপ করার দরকার নেই।',
      changes: [{ name: 'j', from: 0, to: 1 }],
      variables: { arr: [2, 5, 8, 1, 4], i: 0, j: 1 },
      fault: null,
      structure: { kind: 'array', values: [2, 5, 8, 1, 4], highlight: [1, 2], sortedFrom: 5, pointers: { i: 0, j: 1 } },
    },
    {
      stepIndex: 5,
      activeLine: 5,
      analogyType: 'sort_blocks',
      action: 'swap',
      explanation: '`j = 2`: `8` এবং `1` তুলনা করে জায়গা অদলবদল করা হলো (`8 > 1`)।',
      why: '`8` অনেক বড়, তাই সেটিকে ডানে সরিয়ে `1`-কে বামে আনা হলো।',
      changes: [{ name: 'arr[2..3]', from: '8, 1', to: '1, 8' }],
      variables: { arr: [2, 5, 1, 8, 4], i: 0, j: 2 },
      fault: null,
      structure: { kind: 'array', values: [2, 5, 1, 8, 4], highlight: [2, 3], swapping: [2, 3], sortedFrom: 5, pointers: { i: 0, j: 2 } },
    },
    {
      stepIndex: 6,
      activeLine: 5,
      analogyType: 'sort_blocks',
      action: 'swap',
      explanation: '`j = 3`: `8` এবং `4` জায়গা বদল করল। প্রথম পাস শেষে `8` সবার শেষে স্থির হলো!',
      why: 'সবচেয়ে বড় ব্লক `8` এখন নিজের চূড়ান্ত জায়গায় পৌঁছে সবুজ (sorted) হয়ে গেছে।',
      changes: [{ name: 'arr[3..4]', from: '8, 4', to: '4, 8' }],
      variables: { arr: [2, 5, 1, 4, 8], i: 0, j: 3 },
      fault: null,
      structure: { kind: 'array', values: [2, 5, 1, 4, 8], highlight: [3, 4], swapping: [3, 4], sortedFrom: 4, pointers: { i: 0, j: 3 } },
    },
    {
      stepIndex: 7,
      activeLine: 5,
      analogyType: 'sort_blocks',
      action: 'swap',
      explanation: 'দ্বিতীয় পাসে (`i = 1`): `5` একে একে `1` ও `4`-এর সাথে জায়গা বদলে ৪র্থ স্থানে স্থির হলো।',
      why: 'বাকি ব্লকগুলোর মধ্যে `5` সবচেয়ে বড়, তাই এটি `8`-এর ঠিক বামে বসে গেল।',
      changes: [{ name: 'arr', from: '[2, 5, 1, 4, 8]', to: '[2, 1, 4, 5, 8]' }],
      variables: { arr: [2, 1, 4, 5, 8], i: 1, j: 2 },
      fault: null,
      structure: { kind: 'array', values: [2, 1, 4, 5, 8], highlight: [2, 3], swapping: [2, 3], sortedFrom: 3, pointers: { i: 1, j: 2 } },
    },
    {
      stepIndex: 8,
      activeLine: 5,
      analogyType: 'sort_blocks',
      action: 'swap',
      explanation: 'তৃতীয় পাসে (`i = 2`): `2` এবং `1` জায়গা বদল করল, ফলে পুরো অ্যারে সাজানো হয়ে গেল!',
      why: '`1` সবার বামে চলে আসায় `[1, 2, 4, 5, 8]` ক্রমটি পূর্ণ হলো।',
      changes: [{ name: 'arr[0..1]', from: '2, 1', to: '1, 2' }],
      variables: { arr: [1, 2, 4, 5, 8], i: 2, j: 0 },
      fault: null,
      structure: { kind: 'array', values: [1, 2, 4, 5, 8], highlight: [0, 1], swapping: [0, 1], sortedFrom: 0, pointers: { i: 2, j: 0 } },
    },
    {
      stepIndex: 9,
      activeLine: 8,
      analogyType: 'sort_blocks',
      action: 'declare',
      explanation: 'সবগুলো ব্লক ছোট থেকে বড় ক্রমে সাজানো শেষ: `[1, 2, 4, 5, 8]`।',
      why: 'চূড়ান্ত সাজানো অ্যারেটি আউটপুটে প্রিন্ট করা হলো।',
      changes: [],
      variables: { arr: [1, 2, 4, 5, 8], i: 3, j: 0 },
      fault: null,
      structure: { kind: 'array', values: [1, 2, 4, 5, 8], highlight: [], sortedFrom: 0, pointers: {} },
    },
  ],
  finalOutput: '[1, 2, 4, 5, 8]',
  outputExplanation: 'প্রতিটি পাসে সবচেয়ে বড় সংখ্যাটি (`8`, তারপর `5`, তারপর `4`, তারপর `2`) ডান দিকে সরে গেছে, তাই শেষে `[1, 2, 4, 5, 8]` পাওয়া গেছে।',
  verdict: {
    status: 'ok',
    message: 'অ্যারেটি সফলভাবে ছোট থেকে বড় ক্রমে সাজানো হয়েছে।',
  },
};

const BUBBLE_SORT_EN_SIMPLE: ExecutionTrace = {
  ...BUBBLE_SORT_BN_SIMPLE,
  logicSummary: {
    title: 'Bubble Sort — Ascending Order',
    goal: 'Sort `[5, 2, 8, 1, 4]` into ascending order `[1, 2, 4, 5, 8]`.',
    idea: 'Compare adjacent blocks and swap them along curved arcs whenever the left block is taller than the right block. After each pass, the largest remaining block locks into the right tail.',
    keyPoints: [
      'Compare adjacent pair `arr[j]` and `arr[j+1]`',
      'If `arr[j] > arr[j+1]`, swap the two blocks along over/under arcs',
      'Each completed pass locks one more sorted block in mint green at the end',
    ],
    analogyStory: 'Like air bubbles rising to the top of a tank, the largest numbers bubble up to the right end of the array one by one.',
    complexity: {
      time: 'O(n²)',
      space: 'O(1)',
      note: 'Nested loops compare pairs across passes, sorting in-place with no extra array.',
    },
    commonMistakes: [
      'Looping `j` up to `n` instead of `n - 1 - i` causes out-of-bounds access on `arr[j+1]`',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: 'Initialize array `arr` with 5 unsorted blocks `[5, 2, 8, 1, 4]`.' },
    { line: 2, role: 'loop', text: 'Outer loop `i` tracks how many passes have completed.' },
    { line: 3, role: 'loop', text: 'Inner loop `j` scans adjacent block pairs from left to right.' },
    { line: 4, role: 'condition', text: 'Compare whether left block `arr[j]` is greater than right block `arr[j+1]`.' },
    { line: 5, role: 'assign', text: 'Swap `arr[j]` and `arr[j+1]` along curved paths so the smaller block moves left.' },
    { line: 6, role: 'block_end', text: 'End of comparison block.' },
    { line: 7, role: 'block_end', text: 'End of pass; the largest block in this pass is now locked in mint green.' },
    { line: 8, role: 'output', text: 'Print the sorted array `[1, 2, 4, 5, 8]`.' },
  ],
  steps: BUBBLE_SORT_BN_SIMPLE.steps.map((s, idx) => {
    const enSteps = [
      { explanation: 'Create array `arr` with blocks `[5, 2, 8, 1, 4]`.', why: 'Load the initial unsorted numbers into memory.' },
      { explanation: 'Compare `5` and `2` (`5 > 2` is true).', why: 'Check if the first pair is out of order.' },
      { explanation: 'Swap `5` and `2` along over/under arcs.', why: 'Move smaller value `2` before `5`.' },
      { explanation: 'Compare `5` and `8` (`5 > 8` is false).', why: 'Pair is already in order; no swap needed.' },
      { explanation: 'Compare `8` and `1`, then swap them.', why: '`8` is larger than `1`, so `8` moves right.' },
      { explanation: 'Swap `8` and `4`. Pass 1 finishes and locks `8` in mint green!', why: 'The largest element `8` has reached its final sorted index.' },
      { explanation: 'Pass 2 (`i = 1`): `5` swaps past `1` and `4`, locking into index 3.', why: '`5` is the next largest value and settles before `8`.' },
      { explanation: 'Pass 3 (`i = 2`): Swap `2` and `1`. All blocks are now sorted!', why: '`1` moves to index 0, completing `[1, 2, 4, 5, 8]`.' },
      { explanation: 'Output the final sorted array `[1, 2, 4, 5, 8]`.', why: 'All passes are complete.' },
    ];
    return {
      ...s,
      explanation: enSteps[idx].explanation,
      why: enSteps[idx].why,
    };
  }),
  outputExplanation: 'Each pass bubbled the largest remaining number to the right end (`8`, then `5`, then `4`, then `2`), resulting in `[1, 2, 4, 5, 8]`.',
  verdict: {
    status: 'ok',
    message: 'Array sorted in ascending order `[1, 2, 4, 5, 8]`.',
  },
};

const INFINITE_LOOP_BN_SIMPLE: ExecutionTrace = {
  isValidLogic: false,
  errorDetails: {
    line: 3,
    message: 'অসীম লুপ (Infinite Loop): লুপের ভেতরে i-এর মান কখনো বাড়ানো হয়নি (i++ নেই)।',
  },
  language: 'javascript',
  analogyType: 'loop_gauge',
  traceSource: 'builtin_verified',
  logicSummary: {
    title: 'অসীম লুপ: i++ দিতে ভুলে যাওয়া (Missing Increment Fault)',
    goal: '`0` থেকে `4` পর্যন্ত সংখ্যাগুলোর যোগফল বের করার চেষ্টা করা হয়েছে।',
    idea: 'লুপের শর্ত `i < 5` দেওয়া হয়েছে, কিন্তু লুপের ভেতরে `i`-এর মান বাড়ানোর (`i++`) লাইনটি নেই। তাই `i` চিরকাল `0`-ই থেকে যায় এবং চাকাটি থামতেই পারে না!',
    keyPoints: [
      'শুরুতে `i = 0` এবং `sum = 0`',
      'বারবার `i < 5` পরীক্ষা করা হয়, আর `0 < 5` সবসময়ই সত্য হয়',
      '৩ বার ঘোরার পর সিস্টেম নিরাপদে লুপটি থামিয়ে `infinite_loop` ত্রুটি দেখায়',
    ],
    analogyStory: 'দৌড়ের ট্র্যাকে ল্যাপ কাউন্টার যদি ০-তেই আটকে থাকে, তবে ৫ ল্যাপ পূর্ণ করার শর্ত কোনোদিনই পূরণ হবে না।',
    complexity: {
      time: '∞ (Infinite)',
      space: 'O(1)',
      note: '`i` পরিবর্তন না হওয়ায় এই লুপটি নিজে থেকে কখনোই শেষ হবে না।',
    },
    commonMistakes: [
      '`while` লুপের ভেতরে কাউন্টার ভ্যারিয়েবল (`i++`) বাড়াতে ভুলে যাওয়া',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: '`i = 0` এবং `sum = 0` দিয়ে শুরু করা হলো।' },
    { line: 2, role: 'loop', text: 'শর্ত পরীক্ষা: `i < 5` কি সত্য? যেহেতু `i` সবসময় `0`, এটি চিরকাল সত্য থাকে!' },
    { line: 3, role: 'assign', text: '`sum += i` চলছে, কিন্তু `i` কখনো বাড়ছে না (`i++` নেই)!' },
    { line: 4, role: 'block_end', text: 'সতর্কতা! লুপের শেষ লাইনে `i++` না থাকায় আবার `i = 0` নিয়েই লুপ ঘুরবে।' },
    { line: 5, role: 'output', text: 'এই লাইনে প্রোগ্রাম কখনোই পৌঁছাতে পারবে না।' },
  ],
  steps: [
    {
      stepIndex: 1,
      activeLine: 1,
      analogyType: 'loop_gauge',
      action: 'declare',
      explanation: '`i = 0` এবং `sum = 0` সেট করা হলো।',
      why: 'লুপ কাউন্টার ও যোগফল ভ্যারিয়েবল তৈরি করা হলো।',
      changes: [
        { name: 'i', from: null, to: 0 },
        { name: 'sum', from: null, to: 0 },
      ],
      variables: { i: 0, sum: 0 },
      fault: null,
      structure: { kind: 'loop', lap: 0, maxLaps: 3, conditionText: 'i < 5 (0 < 5)', unchangedVar: 'i' },
    },
    {
      stepIndex: 2,
      activeLine: 2,
      analogyType: 'loop_gauge',
      action: 'loop_check',
      explanation: 'ল্যাপ ১: `i < 5` (`0 < 5`) সত্য, তাই লুপের ভেতরে প্রবেশ করল।',
      why: '`i`-এর মান `0`, যা `5`-এর চেয়ে ছোট।',
      changes: [],
      variables: { i: 0, sum: 0 },
      fault: null,
      structure: { kind: 'loop', lap: 1, maxLaps: 3, conditionText: 'i < 5 → true', unchangedVar: 'i' },
    },
    {
      stepIndex: 3,
      activeLine: 3,
      analogyType: 'loop_gauge',
      action: 'loop_check',
      explanation: 'ল্যাপ ২: আবার `i = 0` নিয়েই লুপ ঘুরছে কারণ `i` বাড়েনি!',
      why: 'লুপের ভেতরে `i++` না থাকায় `i`-এর মান `0`-তেই আটকে আছে।',
      changes: [],
      variables: { i: 0, sum: 0 },
      fault: null,
      structure: { kind: 'loop', lap: 2, maxLaps: 3, conditionText: 'i < 5 → true (stuck)', unchangedVar: 'i' },
    },
    {
      stepIndex: 4,
      activeLine: 3,
      analogyType: 'loop_gauge',
      action: 'halt',
      explanation: 'ল্যাপ ৩: `i` এখনো `0`! অসীম লুপ (Infinite Loop) শনাক্ত করে প্রোগ্রাম থামানো হয়েছে।',
      why: '`i` কখনোই পরিবর্তন হচ্ছে না, তাই `i < 5` শর্তটি কোনোদিন মিথ্যা হবে না।',
      changes: [],
      variables: { i: 0, sum: 0 },
      fault: {
        type: 'infinite_loop',
        message: 'অসীম লুপ! ৩ বার ঘোরার পরেও i-এর মান 0 থেকে বদলায়নি।',
        fixHint: 'sum += i; লাইনের নিচে i++; যোগ করুন যাতে প্রতি ধাপে i এক করে বাড়ে।',
        target: 'i',
      },
      structure: { kind: 'loop', lap: 3, maxLaps: 3, conditionText: 'STOP: i never changes', unchangedVar: 'i' },
    },
  ],
  finalOutput: 'HALTED: Infinite Loop (i stuck at 0)',
  outputExplanation: 'লুপের ভেতরে `i++` না থাকায় `i`-এর মান `0`-তেই আটকে ছিল। ৩ ল্যাপ পরেও `i` না বদলানোয় লজিক ল্যাব অসীম লুপটি থামিয়ে দিয়েছে।',
  verdict: {
    status: 'infinite_loop',
    message: 'অসীম লুপ শনাক্ত হয়েছে: ভ্যারিয়েবল i কখনোই পরিবর্তিত হয়নি।',
  },
};

const INFINITE_LOOP_EN_SIMPLE: ExecutionTrace = {
  ...INFINITE_LOOP_BN_SIMPLE,
  errorDetails: {
    line: 3,
    message: 'Infinite Loop: Loop counter `i` is never incremented inside the while loop.',
  },
  logicSummary: {
    title: 'Infinite Loop: Missing Increment (i++)',
    goal: 'Attempt to sum numbers while `i < 5`.',
    idea: 'The loop checks `i < 5`, but nothing inside the loop ever changes `i`. Since `i` stays `0` forever, `0 < 5` never becomes false.',
    keyPoints: [
      '`i` starts at `0` and `sum` starts at `0`',
      'Every lap checks `0 < 5`, which is permanently true',
      'After 3 laps with no change to `i`, Logic Lab halts the runaway loop',
    ],
    analogyStory: 'Running on a track where the lap counter is broken at 0 means you can never reach lap 5.',
    complexity: {
      time: '∞ (Infinite)',
      space: 'O(1)',
      note: 'Never terminates because the loop condition variable `i` is invariant.',
    },
    commonMistakes: [
      'Forgetting `i++` at the end of a `while` loop body',
    ],
  },
  lineNotes: [
    { line: 1, role: 'declare', text: 'Initialize `i = 0` and `sum = 0`.' },
    { line: 2, role: 'loop', text: 'Check `i < 5`. Because `i` stays `0`, this condition is always true!' },
    { line: 3, role: 'assign', text: 'Add `i` (`0`) to `sum`, but never increment `i`!' },
    { line: 4, role: 'block_end', text: 'FAULT! Loop repeats without changing `i`.' },
    { line: 5, role: 'output', text: 'Unreachable line — execution is trapped in the loop above.' },
  ],
  steps: [
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[0],
      explanation: 'Initialize `i = 0` and `sum = 0`.',
      why: 'Set starting values before entering the loop.',
    },
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[1],
      explanation: 'Lap 1: `i < 5` (`0 < 5`) is true, so the loop body runs.',
      why: '`i` is `0`, which satisfies `i < 5`.',
    },
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[2],
      explanation: 'Lap 2: Loop runs again with `i = 0` because `i` was never incremented!',
      why: 'Missing `i++` leaves `i` stuck at `0`.',
    },
    {
      ...INFINITE_LOOP_BN_SIMPLE.steps[3],
      explanation: 'Lap 3: `i` is still `0`! Halted runaway infinite loop.',
      why: 'Variable `i` never changes across iterations.',
      fault: {
        type: 'infinite_loop',
        message: 'Infinite loop halted after 3 laps: variable `i` never changed from 0.',
        fixHint: 'Add `i++;` after `sum += i;` so the loop progresses toward `i = 5`.',
        target: 'i',
      },
    },
  ],
  outputExplanation: 'Because `i++` was omitted inside the `while` block, `i` remained `0` on every lap and line 5 was never reached.',
  verdict: {
    status: 'infinite_loop',
    message: 'Infinite Loop Halted: variable `i` never changed.',
  },
};

function makeDetailedTrace(trace: ExecutionTrace, lang: ExplainLanguage): ExecutionTrace {
  return {
    ...trace,
    steps: trace.steps.map((step) => ({
      ...step,
      why:
        lang === 'bn'
          ? `${step.why} [মেমোরি বিশ্লেষণ: ধাপ #${step.stepIndex}-এ লাইন ${step.activeLine} 실행ের পর সক্রিয় ভ্যারিয়েবল অবস্থা = ${JSON.stringify(step.variables)}]`
          : `${step.why} [Memory view: after step #${step.stepIndex} at line ${step.activeLine}, state = ${JSON.stringify(step.variables)}]`,
    })),
  };
}

export const SAMPLE_PROGRAMS: SampleProgram[] = [
  {
    id: 'swap_correct',
    title_bn: 'দুটি ভ্যারিয়েবল অদলবদল (Swap)',
    title_en: 'Swap Two Variables (Temp Cup)',
    subtitle_bn: '৩টি কাপ ও তরল ঢালার অ্যানিমেশন',
    subtitle_en: '3 glass cups with liquid pouring stream',
    topic: 'Variables & Memory',
    difficulty: 'easy',
    analogyType: 'swap_buckets',
    breadcrumbName: 'swapWithTemp',
    codes: {
      javascript: `let a = 5;\nlet b = 10;\nlet temp = a;\na = b;\nb = temp;\nconsole.log("a:", a, "b:", b);`,
      python: `a = 5\nb = 10\ntemp = a\na = b\nb = temp\nprint("a:", a, "b:", b)`,
      cpp: `int a = 5;\nint b = 10;\nint temp = a;\na = b;\nb = temp;\ncout << "a: " << a << " b: " << b;`,
      java: `int a = 5;\nint b = 10;\nint temp = a;\na = b;\nb = temp;\nSystem.out.println("a: " + a + " b: " + b);`,
    },
    traces: {
      bn: {
        simple: SWAP_CORRECT_BN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_CORRECT_BN_SIMPLE, 'bn'),
      },
      en: {
        simple: SWAP_CORRECT_EN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_CORRECT_EN_SIMPLE, 'en'),
      },
    },
  },
  {
    id: 'swap_faulty',
    title_bn: 'ভুল সোয়াপ (temp ছাড়া মান হারানো)',
    title_en: 'Faulty Swap (No Temp Spill)',
    subtitle_bn: 'তরল উপচে পড়া ও Lost Value ত্রুটি',
    subtitle_en: 'Liquid splash particles & lost value fault',
    topic: 'Common Bugs',
    difficulty: 'easy',
    analogyType: 'swap_buckets',
    isFaultySample: true,
    breadcrumbName: 'brokenSwap',
    codes: {
      javascript: `let a = 5;\nlet b = 10;\na = b;\nb = a;\nconsole.log("a:", a, "b:", b);`,
      python: `a = 5\nb = 10\na = b\nb = a\nprint("a:", a, "b:", b)`,
      cpp: `int a = 5;\nint b = 10;\na = b;\nb = a;\ncout << "a: " << a << " b: " << b;`,
      java: `int a = 5;\nint b = 10;\na = b;\nb = a;\nSystem.out.println("a: " + a + " b: " + b);`,
    },
    traces: {
      bn: {
        simple: SWAP_FAULTY_BN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_FAULTY_BN_SIMPLE, 'bn'),
      },
      en: {
        simple: SWAP_FAULTY_EN_SIMPLE,
        detailed: makeDetailedTrace(SWAP_FAULTY_EN_SIMPLE, 'en'),
      },
    },
  },
  {
    id: 'bubble_sort',
    title_bn: 'বাবল সর্ট (Bubble Sort)',
    title_en: 'Bubble Sort `[5, 2, 8, 1, 4]`',
    subtitle_bn: 'বাঁকা পথে ব্লক সোয়াপ ও সবুজ সর্টেড টেইল',
    subtitle_en: 'Arc block swaps & mint sorted wave',
    topic: 'Sorting',
    difficulty: 'medium',
    analogyType: 'sort_blocks',
    breadcrumbName: 'bubbleSort',
    codes: {
      javascript: `let arr = [5, 2, 8, 1, 4];\nfor (let i = 0; i < 4; i++) {\n  for (let j = 0; j < 4 - i; j++) {\n    if (arr[j] > arr[j + 1]) {\n      [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];\n    }\n  }\n}\nconsole.log(arr);`,
      python: `arr = [5, 2, 8, 1, 4]\nfor i in range(4):\n    for j in range(4 - i):\n        if arr[j] > arr[j + 1]:\n            arr[j], arr[j + 1] = arr[j + 1], arr[j]\n# pass complete\n# all passes done\nprint(arr)`,
      cpp: `int arr[] = {5, 2, 8, 1, 4};\nfor (int i = 0; i < 4; i++) {\n  for (int j = 0; j < 4 - i; j++) {\n    if (arr[j] > arr[j + 1]) {\n      swap(arr[j], arr[j + 1]);\n    }\n  }\n}\n// output [1, 2, 4, 5, 8]`,
      java: `int[] arr = {5, 2, 8, 1, 4};\nfor (int i = 0; i < 4; i++) {\n  for (int j = 0; j < 4 - i; j++) {\n    if (arr[j] > arr[j + 1]) {\n      int t = arr[j]; arr[j] = arr[j+1]; arr[j+1] = t;\n    }\n  }\n}\nSystem.out.println(Arrays.toString(arr));`,
    },
    traces: {
      bn: {
        simple: BUBBLE_SORT_BN_SIMPLE,
        detailed: makeDetailedTrace(BUBBLE_SORT_BN_SIMPLE, 'bn'),
      },
      en: {
        simple: BUBBLE_SORT_EN_SIMPLE,
        detailed: makeDetailedTrace(BUBBLE_SORT_EN_SIMPLE, 'en'),
      },
    },
  },
  {
    id: 'infinite_loop',
    title_bn: 'অসীম লুপ (Missing i++ Bug)',
    title_en: 'Missing-Increment Loop (`while`)',
    subtitle_bn: '৩ ল্যাপ পরে লুপ থামানো ও ত্রুটি নির্দেশনা',
    subtitle_en: 'Halts after 3 laps with STOP fault banner',
    topic: 'Loops & Control Flow',
    difficulty: 'easy',
    analogyType: 'loop_gauge',
    isFaultySample: true,
    breadcrumbName: 'stuckWhileLoop',
    codes: {
      javascript: `let i = 0, sum = 0;\nwhile (i < 5) {\n  sum += i;\n}\nconsole.log(sum);`,
      python: `i = 0\nsum = 0\nwhile i < 5:\n    sum += i\nprint(sum)`,
      cpp: `int i = 0, sum = 0;\nwhile (i < 5) {\n  sum += i;\n}\ncout << sum;`,
      java: `int i = 0, sum = 0;\nwhile (i < 5) {\n  sum += i;\n}\nSystem.out.println(sum);`,
    },
    traces: {
      bn: {
        simple: INFINITE_LOOP_BN_SIMPLE,
        detailed: makeDetailedTrace(INFINITE_LOOP_BN_SIMPLE, 'bn'),
      },
      en: {
        simple: INFINITE_LOOP_EN_SIMPLE,
        detailed: makeDetailedTrace(INFINITE_LOOP_EN_SIMPLE, 'en'),
      },
    },
  },
];

export function resolveTraceForCode(
  code: string,
  language: SupportedLanguage,
  explainLanguage: ExplainLanguage,
  depth: ExplanationDepth,
  activeSampleId?: string
): ExecutionTrace {
  const normalized = code.replace(/\s+/g, ' ').trim();

  // 1. Check if code matches any sample or heuristic pattern
  if (normalized.includes('5, 2, 8, 1, 4') || normalized.includes('arr[j + 1]') || normalized.includes('arr[j+1]')) {
    const sample = SAMPLE_PROGRAMS.find((s) => s.id === 'bubble_sort')!;
    return { ...sample.traces[explainLanguage][depth], language };
  }

  if (normalized.includes('while') && !normalized.includes('i++') && !normalized.includes('i += 1') && !normalized.includes('i = i + 1')) {
    const sample = SAMPLE_PROGRAMS.find((s) => s.id === 'infinite_loop')!;
    return { ...sample.traces[explainLanguage][depth], language };
  }

  if (normalized.includes('a = b') && normalized.includes('b = a') && !normalized.includes('temp')) {
    const sample = SAMPLE_PROGRAMS.find((s) => s.id === 'swap_faulty')!;
    return { ...sample.traces[explainLanguage][depth], language };
  }

  if (normalized.includes('temp')) {
    const sample = SAMPLE_PROGRAMS.find((s) => s.id === 'swap_correct')!;
    return { ...sample.traces[explainLanguage][depth], language };
  }

  // Fallback to selected sample if matched
  if (activeSampleId) {
    const matched = SAMPLE_PROGRAMS.find((s) => s.id === activeSampleId);
    if (matched) {
      return { ...matched.traces[explainLanguage][depth], language };
    }
  }

  // Default fallback to swap_correct
  return { ...SAMPLE_PROGRAMS[0].traces[explainLanguage][depth], language };
}
