import { beforeAll, describe, expect, it } from 'vitest'
import {
  domSelectionToSourceAnchor,
  extractTextAtRange,
  locateSourceRangeInDom,
} from '../../src/lib/anchor'

class MiniText {
  readonly nodeType = 3
  parentNode: MiniElement | null = null
  readonly childNodes: MiniNode[] = []

  constructor(private readonly value: string) {}

  get textContent(): string {
    return this.value
  }
}

class MiniElement {
  readonly nodeType = 1
  parentNode: MiniElement | null = null
  readonly childNodes: MiniNode[] = []

  constructor(
    readonly tagName: string,
    private readonly attrs: Record<string, string> = {},
    children: MiniNode[] = [],
  ) {
    for (const child of children) this.append(child)
  }

  append(child: MiniNode): void {
    child.parentNode = this
    this.childNodes.push(child)
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('')
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }

  hasAttribute(name: string): boolean {
    return this.attrs[name] != null
  }

  querySelectorAll(selector: string): MiniElement[] {
    if (selector !== '[data-src-start][data-src-end]') {
      throw new Error(`Unsupported selector in test DOM: ${selector}`)
    }

    const out: MiniElement[] = []
    const walk = (node: MiniNode): void => {
      if (node.nodeType !== 1) return
      if (node.hasAttribute('data-src-start') && node.hasAttribute('data-src-end')) out.push(node)
      for (const child of node.childNodes) walk(child)
    }

    for (const child of this.childNodes) walk(child)
    return out
  }
}

type MiniNode = MiniElement | MiniText

class MiniRange {
  startContainer: MiniNode
  startOffset: number
  endContainer: MiniNode
  endOffset: number
  collapsed: boolean

  constructor(
    startContainer: MiniNode,
    startOffset: number,
    endContainer: MiniNode,
    endOffset: number,
  ) {
    this.startContainer = startContainer
    this.startOffset = startOffset
    this.endContainer = endContainer
    this.endOffset = endOffset
    this.collapsed = startContainer === endContainer && startOffset === endOffset
  }

  setStart(node: MiniNode, offset: number): void {
    this.startContainer = node
    this.startOffset = offset
    this.collapsed =
      this.startContainer === this.endContainer && this.startOffset === this.endOffset
  }

  setEnd(node: MiniNode, offset: number): void {
    this.endContainer = node
    this.endOffset = offset
    this.collapsed =
      this.startContainer === this.endContainer && this.startOffset === this.endOffset
  }

  toString(): string {
    const root = rootFor(this.startContainer)
    const textNodes = collectTextNodes(root)
    const start = absoluteTextOffset(textNodes, this.startContainer, this.startOffset)
    const end = absoluteTextOffset(textNodes, this.endContainer, this.endOffset)
    const lo = Math.min(start, end)
    const hi = Math.max(start, end)
    return textNodes
      .map((node) => node.textContent)
      .join('')
      .slice(lo, hi)
  }
}

function text(value: string): MiniText {
  return new MiniText(value)
}

function el(attrs: Record<string, string>, children: MiniNode[]): MiniElement {
  return new MiniElement('span', attrs, children)
}

function root(children: MiniNode[]): MiniElement {
  return new MiniElement('div', {}, children)
}

function rootFor(node: MiniNode): MiniElement {
  let cur: MiniNode = node
  while (cur.parentNode) cur = cur.parentNode
  if (cur.nodeType !== 1) throw new Error('test node has no element root')
  return cur
}

function collectTextNodes(node: MiniNode): MiniText[] {
  if (node.nodeType === 3) return [node]
  return node.childNodes.flatMap((child) => collectTextNodes(child))
}

function absoluteTextOffset(
  textNodes: MiniText[],
  boundaryNode: MiniNode,
  boundaryOffset: number,
): number {
  let count = 0
  for (const node of textNodes) {
    if (node === boundaryNode) return count + boundaryOffset
    count += node.textContent.length
  }
  return count
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'Node', {
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    configurable: true,
  })
  Object.defineProperty(globalThis, 'document', {
    value: {
      createRange: () => new MiniRange(text(''), 0, text(''), 0),
    },
    configurable: true,
  })
})

describe('domSelectionToSourceAnchor', () => {
  it('returns null for an empty selection', () => {
    const node = text('hello')
    const doc = root([el({ 'data-src-start': '0', 'data-src-end': '5' }, [node])])
    expect(doc.textContent).toBe('hello')

    const range = new MiniRange(node, 2, node, 2)
    expect(domSelectionToSourceAnchor(range as unknown as Range)).toBeNull()
  })

  it('maps a same source node selection to an exact source range', () => {
    const node = text('hello world')
    root([el({ 'data-src-start': '10', 'data-src-end': '21' }, [node])])

    const range = new MiniRange(node, 0, node, 5)
    expect(domSelectionToSourceAnchor(range as unknown as Range)).toEqual({
      srcStart: 10,
      srcEnd: 15,
      text: 'hello',
    })
  })

  it('maps a selection across source nodes', () => {
    const firstText = text('hello')
    const secondText = text(' world')
    root([
      el({ 'data-src-start': '0', 'data-src-end': '5' }, [firstText]),
      el({ 'data-src-start': '5', 'data-src-end': '11' }, [secondText]),
    ])

    const range = new MiniRange(firstText, 2, secondText, 3)
    expect(domSelectionToSourceAnchor(range as unknown as Range)).toEqual({
      srcStart: 2,
      srcEnd: 8,
      text: 'llo wo',
    })
  })

  it('normalizes reversed range endpoints', () => {
    const firstText = text('hello')
    const secondText = text(' world')
    root([
      el({ 'data-src-start': '0', 'data-src-end': '5' }, [firstText]),
      el({ 'data-src-start': '5', 'data-src-end': '11' }, [secondText]),
    ])

    const range = new MiniRange(secondText, 3, firstText, 2)
    expect(domSelectionToSourceAnchor(range as unknown as Range)).toEqual({
      srcStart: 2,
      srcEnd: 8,
      text: 'llo wo',
    })
  })
})

describe('locateSourceRangeInDom', () => {
  it('locates a same-node source range as a DOM range', () => {
    const node = text('hello world')
    const doc = root([el({ 'data-src-start': '10', 'data-src-end': '21' }, [node])])

    const loc = locateSourceRangeInDom(doc as unknown as HTMLElement, {
      srcStart: 10,
      srcEnd: 15,
      text: 'hello',
    })

    expect(loc?.range.toString()).toBe('hello')
    expect(loc?.elements).toHaveLength(1)
  })

  it('locates a source range across source nodes', () => {
    const firstText = text('hello')
    const secondText = text(' world')
    const doc = root([
      el({ 'data-src-start': '0', 'data-src-end': '5' }, [firstText]),
      el({ 'data-src-start': '5', 'data-src-end': '11' }, [secondText]),
    ])

    const loc = locateSourceRangeInDom(doc as unknown as HTMLElement, {
      srcStart: 2,
      srcEnd: 8,
      text: 'llo wo',
    })

    expect(loc?.range.toString()).toBe('llo wo')
    expect(loc?.elements).toHaveLength(2)
  })

  it('prefers the smallest source-bearing elements', () => {
    const firstText = text('hello')
    const secondText = text(' world')
    const doc = root([
      el({ 'data-src-start': '0', 'data-src-end': '11' }, [
        el({ 'data-src-start': '0', 'data-src-end': '5' }, [firstText]),
        el({ 'data-src-start': '5', 'data-src-end': '11' }, [secondText]),
      ]),
    ])

    const loc = locateSourceRangeInDom(doc as unknown as HTMLElement, {
      srcStart: 2,
      srcEnd: 8,
      text: 'llo wo',
    })

    expect(loc?.range.toString()).toBe('llo wo')
    expect(loc?.elements).toHaveLength(2)
  })

  it('returns null when the source range is not represented in the DOM', () => {
    const doc = root([el({ 'data-src-start': '0', 'data-src-end': '5' }, [text('hello')])])

    expect(
      locateSourceRangeInDom(doc as unknown as HTMLElement, {
        srcStart: 6,
        srcEnd: 8,
        text: '??',
      }),
    ).toBeNull()
  })
})

describe('extractTextAtRange', () => {
  it('slices and normalizes source text', () => {
    expect(extractTextAtRange('alpha   \n\n\nbeta', 0, 15)).toBe('alpha\n\nbeta')
  })
})
