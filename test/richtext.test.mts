import test from 'node:test'
import assert from 'node:assert/strict'
import { htmlToEditable, textToHtml } from '../src/shared/richtext.ts'

const edit = htmlToEditable

test('plain lines become divs; blank lines are empty divs; trailing blanks dropped', () => {
  assert.equal(textToHtml('one\n\ntwo\n\n'), '<div>one</div><div><br></div><div>two</div>')
  assert.equal(textToHtml(''), '')
  assert.equal(textToHtml('  \n '), '')
})

test('markdown-style formatting', () => {
  assert.equal(textToHtml('a **bold** and *italic* [site](https://x.com/a?b=1&c=2)'), '<div>a <b>bold</b> and <i>italic</i> <a href="https://x.com/a?b=1&amp;c=2">site</a></div>')
  assert.equal(textToHtml('- one\n- **two**\n\n1. first\n2. second'), '<ul><li>one</li><li><b>two</b></li></ul><div><br></div><ol><li>first</li><li>second</li></ol>')
})

test('html in the text is escaped, not trusted', () => {
  assert.equal(textToHtml('<script>alert(1)</script> & "q"'), '<div>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "q"</div>')
  assert.equal(textToHtml('[x](javascript:alert(1))'), '<div>[x](javascript:alert(1))</div>')
})

test('stray markers stay literal', () => {
  assert.equal(textToHtml('5 * 3 = 15 and a*b'), '<div>5 * 3 = 15 and a*b</div>')
  assert.equal(textToHtml('**'), '<div>**</div>')
  assert.equal(textToHtml('\\*not italic\\*'), '<div>*not italic*</div>')
})

test('simple ADO html is editable and round-trips', () => {
  for (const html of [
    '<div>Rate limit public API</div>',
    '<p>One</p><p>Two</p>',
    '<div>a<br>b</div><div><br></div><div>c</div>',
    '<div>x <b>bold</b> <i>it</i> <a href="https://example.com/x">link</a></div>',
    '<ul><li>a</li><li><b>b</b></li></ul><div>after</div>',
    '<ol><li>one</li><li>two</li></ol>',
    'bare text<br>second line',
    '<div>fish &amp; chips &lt;3</div>'
  ]) {
    const text = edit(html)
    assert.notEqual(text, null, html)
    // writing it back gives HTML that is itself editable and yields the same text (stable)
    assert.equal(edit(textToHtml(text!)), text, html)
  }
})

test('what the editor writes is editable again, unchanged', () => {
  for (const text of ['hello', 'a **b** *c* [d](https://e.com)', '- x\n- y\n\nz', '1. a\n2. b', '\\- not a list', 'x\n\n\ny']) {
    const html = textToHtml(text)
    assert.equal(textToHtml(edit(html)!), html, text)
  }
})

test('empty or missing html is editable as empty text', () => {
  assert.equal(edit(undefined), '')
  assert.equal(edit('   '), '')
})

test('anything Golau cannot write back unchanged is refused', () => {
  for (const html of [
    '<table><tr><td>x</td></tr></table>',
    '<div><img src="https://x/y.png"></div>',
    '<div style="color:red">x</div>',
    '<div class="a">x</div>',
    '<div><span>x</span></div>',
    '<div><u>x</u></div>',
    '<div><a href="#" data-vss-mention="version:2.0,abc">@Sam</a></div>',
    '<div><a href="javascript:alert(1)">x</a></div>',
    '<div><a href="https://x.com" target="_blank">x</a></div>',
    '<div><div>nested</div></div>',
    '<ul><li>a<ul><li>b</li></ul></li></ul>',
    '<blockquote>q</blockquote>',
    '<h2>title</h2>',
    '<div>x</div><!-- c -->',
    '<div>a &copy; b</div>',
    '<div>unclosed',
    '<div><b>x</i></div>',
    '<ul><li>a</li></ul><ul><li>b</li></ul>'
  ]) {
    assert.equal(edit(html), null, html)
  }
})

test('formatting the text form cannot carry is refused rather than changed', () => {
  assert.equal(edit('<div><b> padded</b></div>'), null)
  assert.equal(htmlToEditable('<div><b>a</b><b>b</b></div>'), '**a****b**') // odd, but it reads back as exactly the same
})
