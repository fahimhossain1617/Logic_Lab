import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCode, executeCode } from '../../server/src/services/toolchains/toolchainManager';
import { generateExecutionTrace } from '../../server/src/services/geminiTraceService';

test('Phase 4A: JavaScript Advanced Test (crypto, class, reduce, random)', async () => {
  const code = `const crypto = require("crypto");

class TransactionManager {

    constructor() {
        this.transactions = [];
    }

    addTransaction(amount, category) {

        const transaction = {
            id: crypto.randomUUID(),
            amount,
            category,
            timestamp: new Date()
        };

        this.transactions.push(transaction);
    }

    getStatistics() {

        const total = this.transactions.reduce(
            (sum, item) => sum + item.amount, 0
        );

        const categories = {};

        for (const item of this.transactions) {
            categories[item.category] =
                (categories[item.category] || 0) + 1;
        }

        return {
            total,
            count: this.transactions.length,
            categories
        };
    }
}

const manager = new TransactionManager();

const categories = ["Food", "Education", "Transport", "Shopping"];

for (let i = 0; i < 100; i++) {

    const amount = Math.floor(Math.random() * 1000) + 1;

    const category =
        categories[Math.floor(Math.random() * categories.length)];

    manager.addTransaction(amount, category);
}

console.log(manager.getStatistics());
`;

  const analysis = await analyzeCode(code, 'javascript', 'main.js');
  assert.equal(analysis.canCompile, true);
  assert.equal(analysis.diagnostics.filter(d => d.severity === 'error').length, 0);

  const exec = await executeCode(code, 'javascript', '', 4000, 'main.js');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('count: 100'));
  assert.ok(exec.stdout.includes('total:'));

  const trace = await generateExecutionTrace({
    code,
    language: 'javascript',
    explainLanguage: 'en',
    depth: 'detailed',
    fileName: 'main.js',
    bypassCache: true,
  });
  assert.equal(trace.trace?.hasError, false);
  assert.equal(trace.trace?.verdict.status, 'ok');
});

test('Phase 4B: C++ Advanced Test (mt19937, uniform_int_distribution, vector, unordered_map, accumulate)', async () => {
  const code = `#include <iostream>
#include <vector>
#include <random>
#include <algorithm>
#include <unordered_map>
#include <numeric>

using namespace std;

int main() {

    mt19937 generator(2026);

    uniform_int_distribution<int> distribution(1, 100);

    vector<int> numbers;

    unordered_map<int, int> frequency;

    for (int i = 0; i < 1000; i++) {

        int value = distribution(generator);

        numbers.push_back(value);

        frequency[value]++;
    }

    sort(numbers.begin(), numbers.end());

    int total = accumulate(
        numbers.begin(),
        numbers.end(),
        0
    );

    double average =
        static_cast<double>(total) / numbers.size();

    cout << "Total Numbers: " << numbers.size() << endl;

    cout << "Minimum: " << numbers.front() << endl;

    cout << "Maximum: " << numbers.back() << endl;

    cout << "Sum: " << total << endl;

    cout << "Average: " << average << endl;

    cout << "Unique Values: " << frequency.size() << endl;

    cout << "Randomized Values:" << endl;

    for (int i = 0; i < 10; i++) {
        cout << numbers[i] << " ";
    }

    cout << endl;

    return 0;
}
`;

  const analysis = await analyzeCode(code, 'cpp', 'main.cpp');
  assert.equal(analysis.canCompile, true);
  assert.equal(analysis.diagnostics.filter(d => d.severity === 'error').length, 0);

  const exec = await executeCode(code, 'cpp', '', 7000, 'main.cpp');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes('Total Numbers: 1000'));
  assert.ok(exec.stdout.includes('Sum:'));
  assert.ok(exec.stdout.includes('Average:'));
});

test('Phase 4C: Python Advanced Test (dataclass, Counter, statistics, datetime)', async () => {
  const code = `import random
import statistics
from collections import Counter
from datetime import datetime
from dataclasses import dataclass

@dataclass
class Transaction:

    amount: float
    category: str
    timestamp: str


class TransactionManager:

    def __init__(self):
        self.transactions = []

    def generate(self, count):

        categories = [
            "Food",
            "Education",
            "Transport",
            "Shopping"
        ]

        for _ in range(count):

            transaction = Transaction(
                amount=round(random.uniform(10, 1000), 2),
                category=random.choice(categories),
                timestamp=datetime.now().isoformat()
            )

            self.transactions.append(transaction)

    def analyze(self):

        amounts = [
            item.amount for item in self.transactions
        ]

        categories = Counter(
            item.category for item in self.transactions
        )

        return {
            "total": round(sum(amounts), 2),
            "average": round(statistics.mean(amounts), 2),
            "maximum": max(amounts),
            "minimum": min(amounts),
            "categories": dict(categories)
        }


manager = TransactionManager()

manager.generate(500)

print(manager.analyze())
`;

  const analysis = await analyzeCode(code, 'python', 'main.py');
  assert.equal(analysis.canCompile, true);
  assert.equal(analysis.diagnostics.filter(d => d.severity === 'error').length, 0);

  const exec = await executeCode(code, 'python', '', 5000, 'main.py');
  assert.equal(exec.status, 'success');
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.stdout.includes("'total':"));
  assert.ok(exec.stdout.includes("'average':"));
  assert.ok(exec.stdout.includes("'categories':"));
});

test('Phase 5 Error Detection: Java Missing Semicolon', async () => {
  const code = `public class SemicolonTest {
    public static void main(String[] args) {
        int x = 42
        System.out.println(x);
    }
}`;
  const analysis = await analyzeCode(code, 'java', 'SemicolonTest.java');
  assert.equal(analysis.canCompile, false);
  const diag = analysis.diagnostics.find(d => d.severity === 'error');
  assert.ok(diag);
  assert.equal(diag?.line, 3);
  assert.ok(diag?.message.includes(';'));
});

test('Phase 5 Error Detection: Java Missing Closing Bracket', async () => {
  const code = `public class BracketTest {
    public static void main(String[] args) {
        if (true) {
            System.out.println("Unclosed brace");
    }
}`;
  const analysis = await analyzeCode(code, 'java', 'BracketTest.java');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.some(d => d.severity === 'error'));
});

test('Phase 5 Error Detection: Java Undefined Variable', async () => {
  const code = `public class UndefinedTest {
    public static void main(String[] args) {
        System.out.println(nonExistentVar);
    }
}`;
  const analysis = await analyzeCode(code, 'java', 'UndefinedTest.java');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.some(d => d.message.includes('nonExistentVar') || d.message.includes('symbol')));
});

test('Phase 5 Error Detection: Java Incompatible Type Conversion', async () => {
  const code = `public class IncompatibleTypeTest {
    public static void main(String[] args) {
        int number = "This is a string";
    }
}`;
  const analysis = await analyzeCode(code, 'java', 'IncompatibleTypeTest.java');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.some(d => d.message.toLowerCase().includes('incompatible') || d.message.toLowerCase().includes('convert')));
});

test('Phase 5 Error Detection: Java Invalid Import', async () => {
  const code = `import com.nonexistent.fake.pkg.FakeClass;

public class InvalidImportTest {
    public static void main(String[] args) {
        System.out.println("Test");
    }
}`;
  const analysis = await analyzeCode(code, 'java', 'InvalidImportTest.java');
  assert.equal(analysis.canCompile, false);
  assert.ok(analysis.diagnostics.some(d => d.message.toLowerCase().includes('package com.nonexistent') || d.message.toLowerCase().includes('does not exist')));
});

test('Phase 5 Error Detection: Java Runtime Exception (ArithmeticException / by zero)', async () => {
  const code = `public class RuntimeDivZero {
    public static void main(String[] args) {
        int a = 10;
        int b = 0;
        int c = a / b;
        System.out.println(c);
    }
}`;
  // Compilation passes
  const analysis = await analyzeCode(code, 'java', 'RuntimeDivZero.java');
  assert.equal(analysis.canCompile, true);

  // Execution fails with runtime error
  const exec = await executeCode(code, 'java', '', 4000, 'RuntimeDivZero.java');
  assert.notEqual(exec.exitCode, 0);
  assert.ok(exec.stderr.includes('ArithmeticException') || (exec.runtimeError && exec.runtimeError.includes('zero')));
});

test('Phase 5 Error Detection: Infinite Loop Execution Timeout', async () => {
  const code = `public class InfiniteLoopTest {
    public static void main(String[] args) {
        while (true) {
            // spin forever
        }
    }
}`;
  const exec = await executeCode(code, 'java', '', 2500, 'InfiniteLoopTest.java');
  assert.equal(exec.timedOut, true);
  assert.equal(exec.status, 'error');
});
