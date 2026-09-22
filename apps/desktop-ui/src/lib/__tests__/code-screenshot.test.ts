import {
  BACKGROUNDS,
  LANGUAGES,
  canFormat,
  escapeHtml,
  formatCode,
  highlightCode,
} from '@/lib/code-screenshot';

describe('highlightCode', () => {
  it('returns empty html for empty input', () => {
    expect(highlightCode('', 'javascript')).toEqual({ html: '', language: 'javascript' });
    expect(highlightCode('', 'auto')).toEqual({ html: '', language: 'plaintext' });
  });

  it('highlights a known JavaScript snippet with hljs token classes', () => {
    const res = highlightCode('function greet(name) { return `hi ${name}`; }', 'javascript');
    expect(res.language).toBe('javascript');
    expect(res.html).toContain('hljs-keyword');
    expect(res.html).toContain('function');
  });

  it('highlights TypeScript, Python and JSON', () => {
    expect(highlightCode('const x: number = 1', 'typescript').html).toContain('hljs-');
    expect(highlightCode('def foo():\n    return 42', 'python').html).toContain('hljs-');
    expect(highlightCode('{"a": [1, 2, true]}', 'json').html).toContain('hljs-');
  });

  it('escapes HTML in the highlighted output', () => {
    const res = highlightCode('const a = "<div>&</div>"', 'javascript');
    expect(res.html).not.toContain('<div>');
    expect(res.html).toContain('&lt;div&gt;');
  });

  it('auto-detects a language for an unambiguous snippet', () => {
    const res = highlightCode('#!/bin/bash\necho "hello" | grep h\nexport FOO=bar', 'auto');
    expect(res.language).toBeTruthy();
    expect(res.language).not.toBe('');
    expect(res.html.length).toBeGreaterThan(0);
  });

  it('falls back to escaped plaintext for an unknown language', () => {
    const res = highlightCode('<b>& "quotes"</b>', 'not-a-language');
    expect(res.language).toBe('plaintext');
    expect(res.html).toBe('&lt;b&gt;&amp; &quot;quotes&quot;&lt;/b&gt;');
    expect(res.html).not.toContain('<b>');
  });

  it('supports every language listed in LANGUAGES', () => {
    for (const { value } of LANGUAGES) {
      const res = highlightCode('test 123', value);
      expect(res.language).toBe(value);
    }
  });
});

describe('escapeHtml', () => {
  it('escapes all special characters', () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });

  it('leaves plain text untouched', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});

describe('formatCode', () => {
  it('reports which languages are formattable', () => {
    for (const l of ['javascript', 'typescript', 'json', 'css', 'xml', 'sql']) {
      expect(canFormat(l)).toBe(true);
    }
    for (const l of ['python', 'rust', 'plaintext', 'auto']) {
      expect(canFormat(l)).toBe(false);
    }
  });

  it('formats minified JSON', async () => {
    const res = await formatCode('{"a":1,"b":[2,3]}', 'json');
    expect(res.error).toBeNull();
    expect(res.output).toBe('{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
  });

  it('formats JavaScript and SQL', async () => {
    const js = await formatCode('function f(){return 1;}', 'javascript');
    expect(js.error).toBeNull();
    expect(js.output).toContain('\n');

    const sql = await formatCode('select id,name from users where id=1', 'sql');
    expect(sql.error).toBeNull();
    expect(sql.output.toLowerCase()).toContain('select');
    expect(sql.output).toContain('\n');
  });

  it('returns input unchanged with error for unsupported language', async () => {
    const res = await formatCode('print("hi")', 'python');
    expect(res.output).toBe('print("hi")');
    expect(res.error).toBeTruthy();
  });

  it('returns input unchanged with error for invalid JSON', async () => {
    const res = await formatCode('{oops', 'json');
    expect(res.output).toBe('{oops');
    expect(res.error).toBeTruthy();
  });

  it('passes empty input through', async () => {
    expect(await formatCode('  ', 'json')).toEqual({ output: '  ', error: null });
  });
});

describe('BACKGROUNDS', () => {
  it('has unique ids and exactly one transparent option', () => {
    const ids = BACKGROUNDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BACKGROUNDS.filter((b) => b.css === null)).toHaveLength(1);
  });
});

describe('highlightCode for beautify/minify languages', () => {
  // The Beautify & Minify tool maps its languages onto these hljs grammars.
  const cases: [string, string][] = [
    ['json', '{"a": 1}'],
    ['css', 'a { color: red; }'],
    ['xml', '<div class="x">hi</div>'],
    ['javascript', 'const a = 1;'],
  ]
  it.each(cases)('emits hljs tokens for %s', (lang, code) => {
    const res = highlightCode(code, lang)
    expect(res.language).toBe(lang)
    expect(res.html).toContain('<span class="hljs-')
  })
})
