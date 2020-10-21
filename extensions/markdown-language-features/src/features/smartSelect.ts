/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Token } from 'markdown-it';
import * as vscode from 'vscode';
import { MarkdownEngine } from '../markdownEngine';
import { TableOfContentsProvider, TocEntry } from '../tableOfContentsProvider';

export default class MarkdownSmartSelect implements vscode.SelectionRangeProvider {

	constructor(
		private readonly engine: MarkdownEngine
	) { }

	public provideSelectionRanges(document: vscode.TextDocument, positions: vscode.Position[], _token: vscode.CancellationToken): Promise<vscode.SelectionRange[]> {
		return Promise.all(positions.map((position) => {
			return this.provideSelectionRange(document, position, _token);
		}));
	}

	private async provideSelectionRange(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.SelectionRange> {
		const headerRange = await this.getHeaderSelectionRange(document, position);
		const blockRange = await this.getBlockSelectionRange(document, position, headerRange);
		return blockRange ? blockRange : headerRange ? headerRange : new vscode.SelectionRange(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)));
		// return this.consolidateRanges(headerRange, blockRange);
	}

	private consolidateRanges(headerRange: vscode.SelectionRange | undefined, blockRange: vscode.SelectionRange | undefined): vscode.SelectionRange {
		if (headerRange && blockRange) {
			const blockParent = blockRange.parent;
			// let ranges = getRanges(blockRange, headerRange);
			if (blockParent) {
				if (headerRange.range.contains(blockParent.range)) {
					if (blockParent.parent && headerRange.range.contains(blockParent.parent.range)) {
						const revisedGrandparent = new vscode.SelectionRange(blockParent.parent.range, headerRange);
						const revisedParent = new vscode.SelectionRange(blockParent.range, revisedGrandparent);
						if (revisedParent.range.contains(blockRange.range)) {
							return new vscode.SelectionRange(blockRange.range, revisedParent);
						}
					} else {
						const revisedParent = new vscode.SelectionRange(blockParent.range, headerRange);
						if (revisedParent.range.contains(blockRange.range)) {
							return new vscode.SelectionRange(blockRange.range, revisedParent);
						}
					}
				} else {
					if (headerRange.range.contains(blockRange.range)) {
						return new vscode.SelectionRange(blockRange.range, headerRange);
					}
				}
			} else {
				if (headerRange.range.contains(blockRange.range)) {
					return new vscode.SelectionRange(blockRange.range, headerRange);
				}
			}
			return blockRange;
		} else if (headerRange) {
			return headerRange;
		} else if (blockRange) {
			return blockRange;
		} else {
			return new vscode.SelectionRange(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)));
		}
	}

	private async getBlockSelectionRange(document: vscode.TextDocument, position: vscode.Position, headerRange?: vscode.SelectionRange): Promise<vscode.SelectionRange | undefined> {

		const tokens = await this.engine.parse(document);

		let enclosingTokens = tokens.filter(token => token.map && (token.map[0] <= position.line && token.map[1] > position.line) && isBlockElement(token));

		if (enclosingTokens.length === 0) {
			return;
		}

		let sortedTokens = enclosingTokens.sort(
			function (token1, token2) {
				if (token2.map[1] - token2.map[0] > token1.map[1] - token1.map[0]) {
					return 1;
				} else if (token2.map[1] - token2.map[0] < token1.map[1] - token1.map[0]) {
					return -1;
				}
				if (Math.abs(position.line - ((token2.map[1] - token2.map[0]) / 2)) < Math.abs(position.line - ((token1.map[1] - token1.map[0]) / 2))) {
					return 1;
				} else if (Math.abs(position.line - ((token2.map[1] - token2.map[0]) / 2)) > Math.abs(position.line - ((token1.map[1] - token1.map[0]) / 2))) {
					return -1;
				} else {
					return 0;
				}
			});
		let parentRange = headerRange ? headerRange : createBlockRange(sortedTokens.shift(), document);
		let currentRange: vscode.SelectionRange | undefined;
		for (const token of sortedTokens) {
			currentRange = createBlockRange(token, document, parentRange);
			if (currentRange && currentRange.parent && parentRange) {
				parentRange = currentRange;
			} else if (currentRange) {
				return currentRange;
			} else {
				return parentRange;
			}
		}
		if (currentRange) {
			return currentRange;
		} else {
			return parentRange;
		}
	}

	private async getHeaderSelectionRange(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.SelectionRange | undefined> {
		const tocProvider = new TableOfContentsProvider(this.engine, document);
		const toc = await tocProvider.getToc();

		let headerOnThisLine = toc.find(header => header.line === position.line);

		let enclosingHeaders = toc.filter(header => header.location.range.start.line <= position.line && header.location.range.end.line >= position.line);
		let sortedHeaders = enclosingHeaders.sort((header1, header2) => (header1.line - position.line) - (header2.line - position.line));

		if (sortedHeaders.length === 0) {
			return undefined;
		}

		let parentRange = createHeaderRange(sortedHeaders.shift());
		let currentRange: vscode.SelectionRange | undefined;

		let index = 0;
		for (const header of sortedHeaders) {
			if (parentRange) {
				if (parentRange.range.contains(header.location.range)) {
					if (index === sortedHeaders.length - 1 && headerOnThisLine) {
						currentRange = new vscode.SelectionRange(header.location.range, parentRange);
					} else {
						currentRange = createHeaderRange(header, parentRange);
					}
				}
			}
			if (currentRange && currentRange.parent) {
				parentRange = createHeaderRange(header, currentRange.parent);
			}
			index++;
		}
		if (currentRange) {
			return currentRange;
		} else {
			return parentRange;
		}
	}
}

let isBlockElement = (token: Token): boolean => {
	return !['list_item_close', 'paragraph_close', 'bullet_list_close', 'inline', 'heading_close', 'heading_open'].includes(token.type);
};

let createHeaderRange = (header: TocEntry | undefined, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined => {
	if (header) {
		let contentRange = new vscode.Range(header.location.range.start.translate(1), header.location.range.end);
		let headerPlusContentRange = header.location.range;
		if (parent && parent.range.contains(headerPlusContentRange)) {
			return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(headerPlusContentRange, parent));
		} else {
			return new vscode.SelectionRange(contentRange, new vscode.SelectionRange(headerPlusContentRange));
		}
	} else {
		return undefined;
	}
};

let createBlockRange = (block: Token | undefined, document: vscode.TextDocument, parent?: vscode.SelectionRange): vscode.SelectionRange | undefined => {
	if (block) {
		if (block.type === 'fence') {
			let blockRange = new vscode.SelectionRange(new vscode.Range(new vscode.Position(block.map[0] > 0 ? block.map[0] - 1 : 0, 0), new vscode.Position(block.map[1], getEndCharacter(document, block.map[0], block.map[1]))));
			let childRange = new vscode.Range(new vscode.Position(block.map[0] + 1, 0), new vscode.Position(block.map[1] - 1, getEndCharacter(document, block.map[0], block.map[1])));
			if (blockRange.range.contains(childRange)) {
				if (parent && parent.range.contains(blockRange.range)) {
					return new vscode.SelectionRange(childRange, new vscode.SelectionRange(blockRange.range, parent));
				} else {
					return new vscode.SelectionRange(childRange, blockRange);
				}
			}
		} else {
			let startLine = document.lineAt(block.map[0]).isEmptyOrWhitespace ? block.map[0] + 1 : block.map[0];
			let endLine = document.lineAt(block.map[1]).isEmptyOrWhitespace ? block.map[1] - 1 : block.map[1];
			let startPos = new vscode.Position(startLine, 0);
			let endPos = new vscode.Position(endLine, getEndCharacter(document, startLine, endLine));
			let range = new vscode.Range(startPos, endPos);
			if (parent && parent.range.contains(range)) {
				return new vscode.SelectionRange(range, parent);
			} else {
				return new vscode.SelectionRange(range);
			}
		}
	}
	return undefined;
};

let getEndCharacter = (document: vscode.TextDocument, startLine: number, endLine: number): number => {
	let startLength = document.lineAt(startLine).text ? document.lineAt(startLine).text.length : 0;
	let endLength = document.lineAt(startLine).text ? document.lineAt(startLine).text.length : 0;
	let endChar = Math.max(startLength, endLength);
	return startLine !== endLine ? 0 : endChar;
};
