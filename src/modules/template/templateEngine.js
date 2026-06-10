function getNestedValue(obj, path) {
  if (!path) return undefined;
  const keys = path.split('.');
  let result = obj;
  for (const key of keys) {
    if (result === null || result === undefined) return undefined;
    result = result[key];
  }
  return result;
}

function isTruthy(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return value !== 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return !!value;
}

function parseBlocks(template) {
  const blocks = [];
  const stack = [];
  let index = 0;

  const blockRegex = /\{\{(#if|#each|\/if|\/each|else)\s*([^}]*?)\s*\}\}/g;

  let lastIndex = 0;
  let match;

  while ((match = blockRegex.exec(template)) !== null) {
    const [fullMatch, tag, args] = match;

    if (match.index > lastIndex) {
      blocks.push({
        type: 'text',
        content: template.substring(lastIndex, match.index)
      });
    }

    if (tag === '#if') {
      stack.push({ type: 'if', args: args.trim(), startIndex: blocks.length, elseIndex: -1 });
      blocks.push({ type: 'ifStart', condition: args.trim() });
    } else if (tag === '#each') {
      stack.push({ type: 'each', args: args.trim(), startIndex: blocks.length });
      blocks.push({ type: 'eachStart', collection: args.trim() });
    } else if (tag === 'else') {
      const top = stack[stack.length - 1];
      if (top && top.type === 'if') {
        top.elseIndex = blocks.length;
        blocks.push({ type: 'else' });
      }
    } else if (tag === '/if') {
      const top = stack.pop();
      if (top && top.type === 'if') {
        blocks.push({ type: 'ifEnd', elseIndex: top.elseIndex });
      }
    } else if (tag === '/each') {
      const top = stack.pop();
      if (top && top.type === 'each') {
        blocks.push({ type: 'eachEnd' });
      }
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < template.length) {
    blocks.push({
      type: 'text',
      content: template.substring(lastIndex)
    });
  }

  return blocks;
}

function renderBlocks(blocks, context, eachIndex = -1) {
  let result = '';
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i];

    if (block.type === 'text') {
      result += renderVariables(block.content, context);
      i++;
    } else if (block.type === 'ifStart') {
      const conditionValue = getNestedValue(context, block.condition);
      const truthy = isTruthy(conditionValue);

      let endIndex = -1;
      let elseIndex = -1;
      let depth = 1;
      let j = i + 1;

      while (j < blocks.length && depth > 0) {
        if (blocks[j].type === 'ifStart') depth++;
        if (blocks[j].type === 'ifEnd') {
          depth--;
          if (depth === 0) {
            endIndex = j;
            if (blocks[j].elseIndex !== -1) {
              elseIndex = blocks[j].elseIndex;
            }
          }
        }
        j++;
      }

      if (truthy) {
        const trueBlocks = blocks.slice(i + 1, elseIndex > -1 ? elseIndex : endIndex);
        result += renderBlocks(trueBlocks, context);
      } else if (elseIndex > -1) {
        const falseBlocks = blocks.slice(elseIndex + 1, endIndex);
        result += renderBlocks(falseBlocks, context);
      }

      i = endIndex + 1;
    } else if (block.type === 'eachStart') {
      const collection = getNestedValue(context, block.collection);

      let endIndex = -1;
      let depth = 1;
      let j = i + 1;

      while (j < blocks.length && depth > 0) {
        if (blocks[j].type === 'eachStart') depth++;
        if (blocks[j].type === 'eachEnd') {
          depth--;
          if (depth === 0) endIndex = j;
        }
        j++;
      }

      const loopBlocks = blocks.slice(i + 1, endIndex);

      if (Array.isArray(collection)) {
        collection.forEach((item, idx) => {
          const itemContext = {
            ...context,
            this: item,
            ...(typeof item === 'object' && item !== null ? item : {}),
            '@index': idx,
            '@first': idx === 0,
            '@last': idx === collection.length - 1
          };
          result += renderBlocks(loopBlocks, itemContext, idx);
        });
      }

      i = endIndex + 1;
    } else {
      i++;
    }
  }

  return result;
}

function renderVariables(template, context) {
  return template.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, key) => {
    const value = getNestedValue(context, key);
    if (value === undefined || value === null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function renderTemplate(template, context) {
  const blocks = parseBlocks(template);
  return renderBlocks(blocks, context);
}

module.exports = {
  renderTemplate,
  getNestedValue,
  isTruthy,
  parseBlocks
};
