define('languageservice', ['vs/editor/editor.main'], function() {
    var Promise = monaco.Promise;

    function registerLanguageService(params, wsHandler) {
        var ClientClass = (params.protocol === 'TS') ? TSClient : LanguageClient;
        var client = new ClientClass(params.lang, wsHandler);
        monaco.languages.onLanguage(params.lang, function() {
            client.init();
        });
        return client;
    }

    function LanguageClient(lang, wsHandler) {
        this._lang = lang;
        this._wsHandler = wsHandler;
        this._id = 0;
        wsHandler.registerClient(lang, this);
        this._initialized = false;
        // Remembers all notifications before it's fully initialized.
        this._notificationQueue = [];

        this._responseWaiters = {};
    }

    LanguageClient.prototype.init = function() {
        var textDocumentCapabilities = {
            synchronization: {
                willSave: true,
                willSaveWaitUntil: true,
                didSave: true,
            },
            completion: {
                comptetionItem: {snippetSupport: true},
            },
        };
        var capabilities = {textDocument: textDocumentCapabilities};
        this.call('initialize', {capabilities: capabilities}).then((resp) => {
            console.log(this);
            console.log(this.capabilities);
            var capabilities = this.capabilities = resp.capabilities;
            var lang = this._lang;
            this._initialized = true;
            setTimeout(() => {
                this._notificationQueue.forEach((item) => {
                    this.notify(item.method, item.params);
                });
                this._notificationQueue = null;
            }, 0);
            if (capabilities.referencesProvider) {
                monaco.languages.registerReferenceProvider(lang, this);
            }
            if (capabilities.renameProvider) {
                monaco.languages.registerRenameProvider(lang, this);
            }
            if (capabilities.signatureHelpProvider) {
                this.signatureHelpTriggerCharacters =
                    capabilities.signatureHelpProvider.triggerCharacters || [];
                monaco.languages.registerSignatureHelpProvider(lang, this);
            }
            if (capabilities.hoverProvider) {
                monaco.languages.registerHoverProvider(lang, this);
            }
            if (capabilities.documentSymbolProvider) {
                monaco.languages.registerDocumentSymbolProvider(lang, this);
            }
            if (capabilities.documentHighlightProvider) {
                monaco.languages.registerDocumentHighlightProvider(lang, this);
            }
            if (capabilities.definitionProvider) {
                monaco.languages.registerDefinitionProvider(lang, this);
            }
            if (capabilities.codeLensProvider) {
                if (capabilities.codeLensProvider.resolveProvider) {
                    this.resolveCodeLens = this.resolveCodeLensImpl;
                }
                monaco.languages.registerCodeLensProvider(lang, this);
            }
            if (capabilities.codeActionProvider) {
                monaco.languages.registerCodeActionProvider(lang, this);
            }
            if (capabilities.documentFormattingProvider) {
                monaco.languages.registerDocumentFormattingEditProvider(lang, this);
            }
            if (capabilities.documentRangeFormattingProvider) {
                monaco.languages.registerDocumentRangeFormattingEditProvider(lang, this);
            }
            if (capabilities.documentOnTypeFormattingProvider) {
                var opts = capabilities.documentOnTypeFormattingProvider;
                this.autoFormatTriggerCharacters = [opts.firstTriggerCharacter];
                if (opts.moreTriggerCharacters) {
                    Array.prototype.push.apply(
                        this.autoFormatTriggerCharacters, opts.moreTriggerCharacters);
                }
                monaco.languages.registerOnTypeFormattingEditProvider(lang, this);
            }
            if (capabilities.documentLinkProvider) {
                if (capabilities.documentLinkProvider.resolveProvider) {
                    this.resolveLink = this.resolveLinkImpl;
                }
                monaco.languages.registerLinkProvider(lang, this);
            }
            if (capabilities.completionProvider) {
                var opts = capabilities.completionProvider;
                if (opts.resolveProvider) {
                    this.resolveCompletionItem = this.resolveCompletionItemImpl;
                }
                if (opts.triggerCharacters) {
                    this.triggerCharacters = opts.triggerCharacters;
                }
                monaco.languages.registerCompletionItemProvider(lang, this);
            }
        });
    };

    LanguageClient.prototype.send = function(method, params, token, withId) {
        var msg = {
            jsonrpc: '2.0',
            method: method,
            params: params,
        };
        if (withId) {
            msg.id = this._id++;
        }
        this._wsHandler.send(this._lang, msg);
        if (withId) {
            var key = msg.id;
            var p = new Promise((r) => {
                this._responseWaiters[key] = r;
            }, () => {
                delete this._responseWaiters[key];
            });
            if (token) {
                token.onCancellationRequested(() => {
 p.cancel();
});
            }
            return p.then(function(resp) {
                if (resp.error) {
                    var err = new Error(resp.error.message);
                    err.code = resp.error.code;
                    err.details = resp.error.data;
                    throw err;
                }
                return resp.result;
            });
        }
    };

    LanguageClient.prototype.call = function(method, params, token) {
        return this.send(method, params, token, true);
    };

    LanguageClient.prototype.notify = function(method, params) {
        if (!this._initialized) {
            this._notificationQueue.push({method: method, params: params});
            return;
        }
        return this.send(method, params, null, false);
    };

    LanguageClient.prototype._onMessage = function(msg) {
        if ('id' in msg) {
            var key = msg.id;
            var waiter = this._responseWaiters[key];
            if (!waiter) {
                console.warn('missing response waiter for ' + key);
                return;
            }
            waiter(msg);
            delete this._responseWaiters[key];
        } else {
            // TODO: handle server notifications.
            console.log(msg);
        }
    };

    LanguageClient.prototype.positionToLS = function(position) {
        return {line: position.lineNumber - 1, character: position.column - 1};
    };

    LanguageClient.prototype.rangeToLS = function(range) {
        return {
            start: {line: range.startLineNumber - 1, character: range.startColumn - 1},
            end: {line: range.endLineNumber - 1, character: range.endColumn - 1},
        };
    };

    LanguageClient.prototype.getDocumentParams = function(model, position) {
        var params = {textDocument: {uri: model.uri.toString()}};
        if (position) {
            params.position = this.positionToLS(position);
        }
        return params;
    };

    LanguageClient.prototype.rangeToMonaco = function(range) {
        return {
            startLineNumber: range.start.line + 1,
            startColumn: range.start.character + 1,
            endLineNumber: range.end.line + 1,
            endColumn: range.end.character + 1,
        };
    };

    LanguageClient.prototype.locationToMonaco = function(location) {
        return {
            uri: monaco.Uri.parse(location.uri),
            range: this.rangeToMonaco(location.range),
        };
    };

    LanguageClient.prototype.onOpen = function(model) {
        var doc = {
            uri: model.uri.toString(),
            languageId: model.getModeId(),
            version: model.getVersionId(),
            text: model.getValue(),
        };
        this.notify('textDocument/didOpen', {textDocument: doc});
    };

    LanguageClient.prototype.willSave = function(model) {
        var params = this.getDocumentParams(model);
        // Reason is always manually save, for now.
        params.reason = 1;
        this.notify('textDocument/willSave', params);
    };

    LanguageClient.prototype.didSave = function(model) {
        var params = this.getDocumentParams(model);
        var sync = this.capabilities.textDocumentSync;
        if (typeof sync === 'object' && sync.save && sync.save.includeText) {
            params.text = model.getValue();
        }
        this.notify('textDocument/didSave', params);
    };

    LanguageClient.prototype.onChange = function(model, change) {
        console.log(this);
        var sync = this.capabilities.textDocumentSync;
        var kind = (typeof sync === 'object') ? sync.change : sync;
        if (!kind) {
            // undefined or null means missing sync config, 0 means no sync.
            // Eitherway the serveri won't care about the changes.
            return;
        }
        var params = this.getDocumentParams(model);
        params.textDocument.version = change.versionId;
        if (kind === 1) {
            // sync kind is FULL. Needs the entire changes.
            params.contentChanges = [{text: model.getValue()}];
        } else {
            // sync kind is INCREMENTAL.
            params.contentChanges = [{
                range: this.rangeToLS(change.range),
                rangeLength: change.rangeLength,
                text: change.text,
            }];
        }
        this.notify('textDocument/didChange', params);
    };

    LanguageClient.prototype.provideReferences = function(model, position, context, token) {
        var params = this.getDocumentParams(model, position);
        params.includeDeclaration = context.includeDeclaration;
        return this.call('textDocument/references', params, token).then((refs) => {
            if (!refs) {
                return refs;
            }
            return refs.map((location) => this.locationToMonaco(location));
        });
    };

    LanguageClient.prototype.provideRenameEdits = function(model, position, newName, token) {
        var params = this.getDocumentParams(model, position);
        params.newName = newName;
        return this.call('textDocument/rename', params, token).then((edits) => {
            var results = [];
            for (var key in edits.changes) {
                var cs = edits.changes[key];
                var uri = monaco.Uri.parse(key);
                cs.forEach((change) => {
                    results.push({
                        uri: uri,
                        range: this.rangeToMonaco(change.range),
                        newText: change.newText,
                    });
                });
            }
            return {edits: results};
        });
    };

    LanguageClient.prototype.provideSignatureHelp = function(model, position, token) {
        return this.call('textDocument/signatureHelp', this.getDocumentParams(model, position), token).then((help) => {
            help.signatures.forEach((sig) => {
                // parameters is optional in LS, but not optional in monaco.
                if (!sig.parameters) {
                    // I've seen python-language-server has 'params' field for 'parameters'.
                    sig.parameters = sig.params || [];
                }
            });
            return help;
        });
    };

    LanguageClient.prototype.provideHover = function(model, position, token) {
        return this.call('textDocument/hover', this.getDocumentParams(model, position), token).then((hover) => {
            if (!hover) {
                return hover;
            }
            if (!Array.isArray(hover.contents)) {
                hover.contents = [hover.contents];
            }
            if (hover.range) {
                hover.range = this.rangeToMonaco(hover.range);
            }
            return hover;
        });
    };

    LanguageClient.prototype.provideDocumentSymbols = function(model, token) {
        return this.call('textDocument/documentSymbol', this.getDocumentParams(model), token).then((syms) => {
            syms.forEach((sym) => {
                // I don't know why, but the number is shifted between LS and VS.
                sym.kind = sym.kind - 1;
                sym.location = this.locationToMonaco(sym.location);
            });
            return syms;
        });
    };

    LanguageClient.prototype.provideDocumentHighlights = function(model, position, token) {
        return this.call('textDocument/documentHighlight', this.getDocumentParams(model, position), token).then((highlights) => {
            return highlights.map((highlight) => {
                return {range: this.rangeToMonaco(highlight.range), kind: highlight.kind - 1};
            });
        });
    };

    LanguageClient.prototype.provideDefinition = function(model, position, token) {
        return this.call('textDocument/definition', this.getDocumentParams(model, position), token).then((def) => {
            if (!Array.isArray(def)) {
                return this.locationToMonaco(def);
            } else {
                return def.map((location) => this.locationToMonaco(location));
            }
            return def;
        });
    };

    LanguageClient.prototype.codeLensToLS = function(lens) {
        lens.range = this.rangeToMonaco(lens.range);
        if (lens.command) {
            lens.command = {
                id: lens.command.command,
                title: lens.command.title,
                arguments: lens.command.arguments,
            };
        }
        return lens;
    };

    LanguageClient.prototype.provideCodeLenses = function(model, token) {
        return this.call('textDocument/codeLens', this.getDocumentParams(model), token).then((lenses) => {
            return lenses.map((lens) => this.codeLensToLS(lens));
        });
    };

    LanguageClient.prototype.resolveCodeLensImpl = function(model, codeLens, token) {
        var params = {range: this.rangeToLS(codeLens.range)};
        if (codeLens.data) {
            params.data = codeLens.data;
        }
        if (codeLens.command) {
            params.command = {
                command: codeLens.command.id,
                title: codeLens.command.title,
                arguments: codeLens.command.arguments,
            };
        }
        return this.call('codeLens/resolve', params, token).then((codeLens) => this.codeLensToLS(codeLens));
    };

    LanguageClient.prototype.provideCodeActions = function(model, position, context, token) {
        var params = this.getDocumentParams(model, position);
        params.context = [];
        context.markers.forEach((marker) => {
            var diag = {range: this.rangeToLS(marker)};
            diag.code = marker.code;
            diag.severity = marker.severity;
            diag.source = marker.source;
            diag.message = marker.message;
            params.context.push(diag);
        });
        return this.call('textDocument/codeAction', params, token).then((commands) => commands.map((command) => {
            return {
                command: {
                    id: command.command,
                    title: command.title,
                    arguments: command.arguments,
                },
                score: 0,
            };
        }));
    };

    LanguageClient.prototype.provideDocumentFormattingEdits = function(model, options, token) {
        var params = this.getDocumentParams(model);
        params.options = options;
        return this.call('textDocument/formatting', params, token).then((edits) => {
            edits.forEach((edit) => {
                edit.range = this.rangeToMonaco(edit.range);
            });
            return edits;
        });
    };

    LanguageClient.prototype.provideDocumentRangeFormattingEdits = function(model, range, options, token) {
        var params = this.getDocumentParams(model);
        params.range = this.rangeToLS(range);
        params.options = options;
        return this.call('textDocument/rangeFormatting', params, token).then((edits) => {
            edits.forEach((edit) => {
                edit.range = this.rangeToMonaco(edit.range);
            });
            return edits;
        });
    };

    LanguageClient.prototype.provideOnTypeFormattingEdits = function(model, position, ch, options, token) {
        var params = this.getDocumentParams(model, position);
        params.ch = ch;
        params.options = options;
        return this.call('textDocument/onTypeFormatting', params, token).then((edits) => {
            edits.forEach((edit) => {
                edit.range = this.rangeToMonaco(edit.range);
            });
            return edits;
        });
    };

    LanguageClient.prototype.provideLinks = function(model, token) {
        return this.call('textDocument/documentLink', this.getDocumentParams(model), token).then((links) => {
            links = links || [];
            return links.map((link) => {
                return {
                    range: this.rangeToMonaco(link.range),
                    uri: monaco.Uri.parse(link.target),
                };
            });
        });
    };

    LanguageClient.prototype.resolveLinkImpl = function(link, token) {
        var params = {range: this.rangeToLS(link.range), target: link.uri.toString()};
        return this.call('documentLink/resolve', params, token).then((link) => {
            return {range: this.rangeToMonaco(link.range), uri: monaco.Uri.parse(link.target)};
        });
    };

    LanguageClient.prototype.provideCompletionItems = function(model, position, token) {
        return this.call('textDocument/completion', this.getDocumentParams(model, position), token).then((comps) => {
            var items = Array.isArray(comps) ? comps : comps.items;
            items.forEach((item) => {
                if (item.insertText && item.insertTextFormat == 2) {
                    item.insertText = {value: item.insertText};
                }
                if (item.textEdit) {
                    item.textEdit.range = this.rangeToMonaco(item.textEdit.range);
                }
            });
            return comps;
        });
    };

    LanguageClient.prototype.resolveCompletionItemImpl = function(item, token) {
        if (typeof item.insertText === 'object') {
            item.insertText = item.insertText.value;
            item.insertTextFormat = 2;
        }
        if (item.textEdit) {
            item.textEdit.range = this.rangetoLS(item.textEdit.range);
        }
        return this.call('completionItem/resolve', item, token).then((item) => {
            if (item.insertText && item.insertTextFormat == 2) {
                item.insertText = {value: item.insertText};
            }
            if (item.textEdit) {
                item.textEdit.range = this.rangeToMonaco(item.textEdit.range);
            }
            return item;
        });
    };

    function TSClient(lang, wsHandler) {
        this._lang = lang;
        this._wsHandler = wsHandler;
        this._id = 0;
        this._responseWaiters = {};
        wsHandler.registerClient(lang, this);
    }

    TSClient.prototype.send = function(command, arguments, typ, waitResponse, token) {
        var msg = {
            seq: this._id++,
            command: command,
            arguments: arguments,
            type: typ,
        };
        this._wsHandler.send(this._lang, msg);
        if (waitResponse) {
            var key = msg.seq;
            var p = new Promise((r) => {
                this._responseWaiters[key] = r;
            }, () => {
                delete this._responseWaiters[key];
            });
            if (token) {
                token.onCancellationRequested(() => {
                    p.cancel();
                });
            }
            return p.then(function(resp) {
                if (!resp.success) {
                    var err = new Error(resp.message);
                    throw err;
                }
                return resp.body;
            });
        }
    };

    TSClient.prototype.notify = function(command, arguments, token) {
        this.send(command, arguments, 'request', false, token);
    };

    TSClient.prototype.call = function(command, arguments, token) {
        return this.send(command, arguments, 'request', true, token);
    };

    TSClient.prototype._onMessage = function(msg) {
        console.log(msg);
        if (msg.type === 'response') {
            var key = msg.request_seq;
            if (!key) {
                console.warn('no request_seq in response', msg);
                return;
            }
            var waiter = this._responseWaiters[key];
            if (!waiter) {
                console.warn('no waiter found', msg);
                return;
            }
            delete this._responseWaiters[key];
            waiter(msg);
        } else {
            // TODO: do something for events.
            console.log(msg);
        }
    };

    TSClient.prototype.init = function() {
        // TODO: register.
        monaco.languages.registerReferenceProvider(this._lang, this);
        monaco.languages.registerRenameProvider(this._lang, this);
        monaco.languages.registerSignatureHelpProvider(this._lang, this);
        monaco.languages.registerHoverProvider(this._lang, this);
        monaco.languages.registerDocumentSymbolProvider(this._lang, this);
        monaco.languages.registerDocumentHighlightProvider(this._lang, this);
        monaco.languages.registerDefinitionProvider(this._lang, this);
        monaco.languages.registerImplementationProvider(this._lang, this);
        monaco.languages.registerDocumentRangeFormattingEditProvider(this._lang, this);
        monaco.languages.registerOnTypeFormattingEditProvider(this._lang, this);
        monaco.languages.registerCompletionItemProvider(this._lang, this);
    };

    TSClient.prototype.onOpen = function(model) {
        this.notify('open', {file: model.uri.path, fileContent: model.getValue()});
    };

    TSClient.prototype.willSave = function(model) {
        // do nothing.
    };

    TSClient.prototype.didSave = function(model) {
        // do nothing.
    };

    TSClient.prototype.onChange = function(model, change) {
        var params = {
            file: model.uri.path,
            line: change.range.startLineNumber,
            offset: change.range.startColumn,
            endLine: change.range.endLineNumber,
            endOffset: change.range.endColumn,
            insertString: change.text,
        };
        this.notify('change', params);
    };

    TSClient.prototype.fileLocation = function(model, position) {
        var params = {file: model.uri.path};
        if (position) {
            params.line = position.lineNumber;
            params.offset = position.column;
        };
        return params;
    };

    TSClient.prototype.rangeToTS = function(range) {
        return {
            start: {line: range.startLineNumber, offset: range.startColumn},
            end: {line: range.endLineNumber, offset: range.endColumn},
        };
    };

    TSClient.prototype.rangeToMonaco = function(range) {
        return {
            startLineNumber: range.start.line,
            startColumn: range.start.offset,
            endLineNumber: range.end.line,
            endColumn: range.end.offset,
        };
    };

    TSClient.prototype.fileSpanToMonaco = function(span) {
        return {uri: monaco.Uri.file(span.file), range: this.rangeToMonaco(span)};
    };

    TSClient.prototype.provideReferences = function(model, position, context, token) {
        return this.call('references', this.fileLocation(model, position), token).then((refs) => {
            var results = [];
            refs.refs.forEach((ref) => {
                if (!ref.isDefinition || context.includeDeclaration) {
                    results.push({
                        uri: monaco.Uri.file(ref.file),
                        range: this.rangetoMonaco(ref),
                    });
                }
            });
            return results;
        });
    };

    TSClient.prototype.provideRenameEdits = function(model, position, newName, token) {
        return this.call('rename', this.fileLocation(model, position), token).then((rename) => {
            if (!rename.info.canRename) {
                return {edits: [], rejectionReason: rename.info.localizedErrorMessage};
            }
            var edits = [];
            rename.locs.forEach((fileLoc) => {
                fileLoc.locs.forEach((loc) => {
                    edits.push({
                        resource: monaco.Uri.file(fileLoc.file),
                        range: this.rangeToMonaco(loc),
                        newText: newName,
                    });
                });
            });
            return {edits: edits};
        });
    };

    TSClient.prototype.signatureHelpTriggerCharacters = ['('];
    TSClient.prototype.provideSignatureHelp = function(model, position, token) {
        return this.call(
            'signatureHelp', this.fileLocation(model, position), token).then((help) => {
                var sigs = [];
                help.items.forEach((item) => {
                    sigs.push({
                        label: item.displayParts.map((p) => p.text).join(),
                        documentation: item.documentation.map(
                            (doc) => doc.text).join(),
                        parameters: item.parameters.map((p) => {
                            return {
                                label: p.name,
                                documentation: p.documentation.map(
                                    (doc) => doc.text).join('\n'),
                            };
                        }),
                    });
                });
                return {
                    signatures: sigs,
                    activeSignature: help.selectedItemIndex,
                    activeParameter: help.argumentIndex,
                };
            });
    };

    TSClient.prototype.provideHover = function(model, position, token) {
        return this.call('quickinfo', this.fileLocation(model, position), token).then((info) => {
            contents = [{language: this._lang, value: info.displayString}];
            if (info.documentation) {
                contents.push({language: this._lang, value: info.documentation});
            }
            return {contents: contents, range: this.rangeToMonaco(info)};
        });
    };

    TSClient.prototype.provideDocumentSymbols = function(model, token) {
        var kindMapping = {
            'keyword': undefined,
            'script': undefined,
            'module': monaco.languages.SymbolKind.Module,
            'class': monaco.languages.SymbolKind.Class,
            'local class': monaco.languages.SymbolKind.Class,
            'interface': monaco.languages.SymbolKind.Interface,
            'type': undefined,
            'enum': monaco.languages.SymbolKind.Enum,
            'var': monaco.languages.SymbolKind.Variable,
            'local var': monaco.languages.SymbolKind.Variable,
            'function': monaco.languages.SymbolKind.Function,
            'local function': monaco.languages.SymbolKind.Function,
            'method': monaco.languages.SymbolKind.Method,
            'getter': monaco.languages.SymbolKind.Property,
            'setter': monaco.languages.SymbolKind.Method,
            'property': monaco.languages.SymbolKind.Property,
            'constructor': monaco.languages.SymbolKind.Constructor,
            'call': undefined,
            'index': undefined,
            'construct': monaco.languages.SymbolKind.Constructor,
            'parameter': undefined,
            'type parameter': undefined,
            'primitive type': undefined,
            'label': monaco.languages.SymbolKind.Constant,
            'alias': monaco.languages.SymbolKind.Variable,
            'const': monaco.languages.SymbolKind.Constant,
            'let': monaco.languages.SymbolKind.Variable,
            'directory': undefined,
            'external module name': monaco.languages.SymbolKind.Module,
        };
        return this.call('navbar', this.fileLocation(model), token).then((items) => {
            var results = [];
            items.forEach((item) => {
                if (kindMapping[item.kind] === undefined) {
                    return;
                }
                // TODO: scan "children" and build parentName in the results.
                results.push({
                    name: item.text,
                    kind: kindMapping[item.kind],
                    location: {uri: model.uri, range: this.rangeToMonaco(item.spans[0])},
                });
            });
            console.log(results);
            return results;
        });
    };

    TSClient.prototype.provideDocumentHighlights = function(model, position, token) {
        var params = this.fileLocation(model, position);
        params.filesToSearch = [];
        var kindMapping = {
            none: monaco.languages.DocumentHighlightKind.Text,
            definition: monaco.languages.DocumentHighlightKind.Read,
            reference: monaco.languages.DocumentHighlightKind.Read,
            writtenReference: monaco.languages.DocumentHighlightKind.Write,
        };
        return this.call('documentHighlights', params, token).then((highlights) => {
            return highlights.map((highlight) => {
                var span = highlight.highlightSpans[0];
                return {range: this.rangeToMonaco(span), kind: kindMapping[span.kind]};
            });
        });
    };

    TSClient.prototype.provideDefinition = function(model, position, token) {
        return this.call('definition', this.fileLocation(model, position), token).then((def) => {
            return def.map((d) => this.fileSpanToMonaco(d));
        });
    };

    TSClient.prototype.provideImplementation = function(model, position, token) {
        return this.call('implementation', this.fileLocation(model, position), token).then((impl) => {
            return impl.map((i) => this.fileSpantoMonaco(i));
        });
    };

    TSClient.prototype.provideDocumentRangeFormattingEdits = function(model, range, options, token) {
        var params = this.fileLocation(model, range.start);
        params.endLine = range.endLineNumber;
        params.endOffset = range.endColumn;
        params.options = {tabSize: options.tabSize, convertTabsToSpaces: options.insertSpaces};
        return this.call('format', params, token).then((edits) => {
            return edits.map((edit) => {
                return {range: this.rangeToMonaco(edit), text: edit.newText};
            });
        });
    };

    TSClient.prototype.autoFormatTriggerCharacters = ['\n', ';', '}'];
    TSClient.prototype.provideOnTypeFormattingEdits = function(model, position, ch, options, token) {
        var params = this.fileLocation(model, position);
        params.key = ch;
        params.options = {tabSize: options.tabSize, convertTabsToSpaces: options.insertSpaces};
        return this.call('formatonkey', params, token).then((edits) => {
            return edits.map((edit) => {
                return {range: this.rangeToMonaco(edit), text: edit.newText};
            });
        });
    };

    TSClient.prototype.triggerCharacters = ['.'];
    TSClient.prototype.provideCompletionItems = function(model, position, token) {
        var kindMapping = {
            'warning': monaco.languages.CompletionItemKind.Value,
            'keyword': monaco.languages.CompletionItemKind.Keyword,
            'module': monaco.languages.CompletionItemKind.Module,
            'class': monaco.languages.CompletionItemKind.Class,
            'local class': monaco.languages.CompletionItemKind.Class,
            'interface': monaco.languages.CompletionItemKind.Interface,
            'enum': monaco.languages.CompletionItemKind.Enum,
            'var': monaco.languages.CompletionItemKind.Variable,
            'local var': monaco.languages.CompletionItemKind.Variable,
            'function': monaco.languages.CompletionItemKind.Function,
            'local function': monaco.languages.CompletionItemKind.Function,
            'method': monaco.languages.CompletionItemKind.Method,
            'getter': monaco.languages.CompletionItemKind.Property,
            'setter': monaco.languages.CompletionItemKind.Method,
            'property': monaco.languages.CompletionItemKind.Property,
            'constructor': monaco.languages.CompletionItemKind.Constructor,
            'construct': monaco.languages.CompletionItemKind.Constructor,
            'label': monaco.languages.CompletionItemKind.Variable,
            'alias': monaco.languages.CompletionItemKind.Variable,
            'const': monaco.languages.CompletionItemKind.Variable,
            'let': monaco.languages.CompletionItemKind.Variable,
            'external module name': monaco.languages.CompletionItemKind.Module,
        };
        var params = this.fileLocation(model, position);
        params.prefix = '.';
        return this.call('completions', params, token).then((comps) => {
            var results = [];
            comps.forEach((comp) => {
                if (!kindMapping[comp.kind]) {
                    return;
                }
                var result = {
                    label: comp.name,
                    kind: kindMapping[comp.kind],
                    sortText: comp.sortText,
                };
                if (comp.replacementSpan) {
                    result.range = this.rangeToMonaco(comp.replacementSpan);
                }
                results.push(result);
            });
            return results;
        });
    };

    function WsHandler(ws) {
        this._ws = ws;
        this._clients = {};
        ws.addEventListener('message', (ev) => {
            var data = ev.data;
            var m = data.match(/^2([a-zA-Z0-9_-]+)/);
            if (!m) {
                return;
            }
            var lang = m[1];
            console.log(data.slice(m[0].length));
            var content = JSON.parse(data.slice(m[0].length));
            var client = this._clients[lang];
            if (!client) {
                console.warn('client for ' + lang + ' is not found');
                return;
            }
            client._onMessage(content);
        });
    }

    WsHandler.prototype.registerClient = function(lang, client) {
        if (lang in this._clients) {
            console.warn('Client already exists! Overwriting...');
        }
        this._clients[lang] = client;
    };

    WsHandler.prototype.send = function(lang, msg, requiresReply) {
        console.log(msg);
        this._ws.send('2' + lang + JSON.stringify(msg));
    };
    return {WsHandler: WsHandler, registerLanguageService: registerLanguageService};
});
