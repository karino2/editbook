define('languageservice', ['vs/editor/editor.main'], function() {
    var Promise = monaco.Promise;

    function registerLanguageService(lang, wsHandler) {
        var client = new LanguageClient(lang, wsHandler);
        monaco.languages.onLanguage(lang, function() {
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
                didSave: true
            },
            completion: {
                comptetionItem: {snippetSupport: true}
            }
        }
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
    }

    LanguageClient.prototype.send = function(method, params, token, withId) {
        var msg = {
            jsonrpc: '2.0',
            method: method,
            params: params
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
                token.onCancellationRequested(() => { p.cancel(); });
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
            end: {line: range.endLineNumber - 1, character: range.endColumn - 1}
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
            endColumn: range.end.character + 1
        };
    };

    LanguageClient.prototype.locationToMonaco = function(location) {
        return {
            uri: monaco.Uri.parse(location.uri),
            range: this.rangeToMonaco(location.range)
        };
    };

    LanguageClient.prototype.onOpen = function(model) {
        var doc = {
            uri: model.uri.toString(),
            languageId: model.getModeId(),
            version: model.getVersionId(),
            text: model.getValue()
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
                text: change.text
            }];
        }
        this.notify('textDocument/didChange', params);
    };

    LanguageClient.prototype.provideReferences = function(model, position, context, token) {
        var params = this.getDocumentParams(model, position);
        params.includeDeclaration = context.includeDeclaration;
        return this.call('textDocument/references', params, token).then((refs) => {
            if (!refs) { return refs; }
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
                        newText: change.newText
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
                arguments: lens.command.arguments
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
                arguments: codeLens.command.arguments
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
                    arguments: command.arguments
                },
                score: 0
            };
        }));
    };

    LanguageClient.prototype.provideDocumentFormattingEdits = function(model, options, token) {
        var params = this.getDocumentParams(model);
        params.options = options;
        return this.call('textDocument/formatting', params, token).then((edits) => {
            edits.forEach((edit) => { edit.range = this.rangeToMonaco(edit.range); });
            return edits;
        });
    };

    LanguageClient.prototype.provideDocumentRangeFormattingEdits = function(model, range, options, token) {
        var params = this.getDocumentParams(model);
        params.range = this.rangeToLS(range);
        params.options = options;
        return this.call('textDocument/rangeFormatting', params, token).then((edits) => {
            edits.forEach((edit) => { edit.range = this.rangeToMonaco(edit.range); });
            return edits;
        });
    };

    LanguageClient.prototype.provideOnTypeFormattingEdits = function(model, position, ch, options, token) {
        var params = this.getDocumentParams(model, position);
        params.ch = ch;
        params.options = options;
        return this.call('textDocument/onTypeFormatting', params, token).then((edits) => {
            edits.forEach((edit) => { edit.range = this.rangeToMonaco(edit.range); });
            return edits;
        });
    };

    LanguageClient.prototype.provideLinks = function(model, token) {
        return this.call('textDocument/documentLink', this.getDocumentParams(model), token).then((links) => {
            links = links || [];
            return links.map((link) => {
                return {range: this.rangeToMonaco(link.range),
                        uri: monaco.Uri.parse(link.target)};
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
    }
    return {WsHandler: WsHandler, LanguageClient: LanguageClient, registerLanguageService: registerLanguageService};
});
