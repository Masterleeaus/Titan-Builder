import test from 'node:test';
import assert from 'node:assert';
import { mergeMarkdownFencesIntoOperations, mergeYamlFencesIntoOperations } from './markdown-agent.js';

test('mergeMarkdownFencesIntoOperations', async (t) => {
  await t.test('one unlabeled fence with one pending markdown operation succeeds', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'test.md', content: '' },
    ];
    const markdown = '```markdown\n# Content\n```';
    const result = mergeMarkdownFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '# Content');
  });

  await t.test('one unlabeled fence with multiple pending markdown operations fails', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'test1.md', content: '' },
      { action: 'CREATE_FILE', path: 'test2.md', content: '' },
    ];
    const markdown = '```markdown\n# Content\n```';
    assert.throws(
      () => mergeMarkdownFencesIntoOperations(operations, markdown),
      /One unlabeled Markdown fence cannot be assigned/,
    );
  });

  await t.test('multiple unlabeled fences with any pending operations fails', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'test1.md', content: '' },
      { action: 'CREATE_FILE', path: 'test2.md', content: '' },
    ];
    const markdown = '```markdown\n# Content 1\n```\n```markdown\n# Content 2\n```';
    assert.throws(
      () => mergeMarkdownFencesIntoOperations(operations, markdown),
      /Multiple unlabeled Markdown fences/,
    );
  });

  await t.test('labeled blocks match exact paths', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'file1.md', content: '' },
      { action: 'CREATE_FILE', path: 'file2.md', content: '' },
    ];
    const markdown = '```markdown file:file1.md\n# Content 1\n```\n```markdown file:file2.md\n# Content 2\n```';
    const result = mergeMarkdownFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '# Content 1');
    assert.equal(result[1].content, '# Content 2');
  });

  await t.test('duplicate labeled paths are rejected', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'file.md', content: '' },
    ];
    const markdown = '```markdown file:file.md\n# Content 1\n```\n```markdown file:file.md\n# Content 2\n```';
    assert.throws(
      () => mergeMarkdownFencesIntoOperations(operations, markdown),
      /Duplicate Markdown block path/,
    );
  });

  await t.test('operations without content are ignored', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'test.md', content: '# Already has content' },
      { action: 'CREATE_FILE', path: 'other.md', content: '' },
    ];
    const markdown = '```markdown\n# New content\n```';
    const result = mergeMarkdownFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '# Already has content');
    assert.equal(result[1].content, '# New content');
  });

  await t.test('non-markdown files are not matched by unlabeled fences', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'test.js', content: '' },
      { action: 'CREATE_FILE', path: 'test.md', content: '' },
    ];
    const markdown = '```markdown\n# Content\n```';
    const result = mergeMarkdownFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '');
    assert.equal(result[1].content, '# Content');
  });

  await t.test('mixed labeled and unlabeled blocks work correctly', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'file1.md', content: '' },
      { action: 'CREATE_FILE', path: 'file2.md', content: '' },
    ];
    const markdown = '```markdown file:file1.md\n# Content 1\n```\n```markdown\n# Content 2\n```';
    const result = mergeMarkdownFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '# Content 1');
    assert.equal(result[1].content, '# Content 2');
  });

  await t.test('labeled block for unlisted file is ignored', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'file1.md', content: '' },
    ];
    const markdown = '```markdown file:file2.md\n# Content for file2\n```\n```markdown\n# Content for file1\n```';
    const result = mergeMarkdownFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '# Content for file1');
  });
});

test('mergeYamlFencesIntoOperations', async (t) => {
  await t.test('one unlabeled fence with one pending yaml operation succeeds', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config.yaml', content: '' },
    ];
    const markdown = '```yaml\nkey: value\n```';
    const result = mergeYamlFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, 'key: value');
  });

  await t.test('one unlabeled fence with multiple pending yaml operations fails', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config1.yaml', content: '' },
      { action: 'CREATE_FILE', path: 'config2.yml', content: '' },
    ];
    const markdown = '```yaml\nkey: value\n```';
    assert.throws(
      () => mergeYamlFencesIntoOperations(operations, markdown),
      /One unlabeled YAML fence cannot be assigned/,
    );
  });

  await t.test('multiple unlabeled fences with any pending operations fails', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config1.yaml', content: '' },
      { action: 'CREATE_FILE', path: 'config2.yaml', content: '' },
    ];
    const markdown = '```yaml\nkey1: value1\n```\n```yaml\nkey2: value2\n```';
    assert.throws(
      () => mergeYamlFencesIntoOperations(operations, markdown),
      /Multiple unlabeled YAML fences/,
    );
  });

  await t.test('labeled yaml blocks match exact paths', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config1.yaml', content: '' },
      { action: 'CREATE_FILE', path: 'config2.yml', content: '' },
    ];
    const markdown = '```yaml file:config1.yaml\nkey1: value1\n```\n```yaml file:config2.yml\nkey2: value2\n```';
    const result = mergeYamlFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, 'key1: value1');
    assert.equal(result[1].content, 'key2: value2');
  });

  await t.test('duplicate labeled yaml paths are rejected', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config.yaml', content: '' },
    ];
    const markdown = '```yaml file:config.yaml\nkey1: value1\n```\n```yaml file:config.yaml\nkey2: value2\n```';
    assert.throws(
      () => mergeYamlFencesIntoOperations(operations, markdown),
      /Duplicate YAML block path/,
    );
  });

  await t.test('non-yaml files are not matched by unlabeled fences', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config.json', content: '' },
      { action: 'CREATE_FILE', path: 'config.yaml', content: '' },
    ];
    const markdown = '```yaml\nkey: value\n```';
    const result = mergeYamlFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, '');
    assert.equal(result[1].content, 'key: value');
  });

  await t.test('both .yml and .yaml extensions are recognized', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config.yml', content: '' },
    ];
    const markdown = '```yaml\nkey: value\n```';
    const result = mergeYamlFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, 'key: value');
  });

  await t.test('empty unlabeled list returns unchanged operations', () => {
    const operations = [
      { action: 'CREATE_FILE', path: 'config.yaml', content: 'existing' },
    ];
    const markdown = 'No code fences here';
    const result = mergeYamlFencesIntoOperations(operations, markdown);
    assert.equal(result[0].content, 'existing');
  });
});
