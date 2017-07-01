'use strict';

var gCurrent;
var gMenu;

function notifyModifyStatusChanged() {
    gMenu.setEnabled(gCurrent.dirty);
}

// eslint-disable-next-line no-unused-vars
EditBook.newEditor = function(ws) {
    var menu = new MonacoMenu();
    var mainEditor = new EditBookMonacoEditor(menu.mainDiv);
    var subEditor = new EditBookMonacoEditor(menu.subDiv);
    var languageServiceNS;

    function connectToLanguageService(ws, languageservice, callback) {
        initializeLanguageServices(ws, languageservice, function(services, lsns) {
            mainEditor.registerLangServices(services);
            subEditor.registerLangServices(services);

            if(callback) callback();
        });
    }

    var onInit = initializeModule();
    onInit.push(() => mainEditor.init());
    onInit.push(() => subEditor.init());
    onInit.push((_, languageservice) => {
        languageServiceNS = languageservice;
        connectToLanguageService(ws, languageservice);
    });

    gCurrent = mainEditor;
    gMenu = menu;

    $(window).resize(()=> {
        if(menu.isSplit()) {
            mainEditor.editor.layout();
            subEditor.editor.layout();
        } else {
            mainEditor.editor.layout();
        }
    });

    menu.save = () => gCurrent.save();
    menu.splitWindow = (mainDiv, subDiv) => {
        mainEditor.editor.layout();
        subEditor.editor.layout();
        subEditor.editor.setModel(mainEditor.editor.getModel());
        subEditor.path = mainEditor.path;
    };
    menu.unsplitWindow = (mainDiv) => {
        if(gCurrent != mainEditor) {
            // we want to detach sub_editor from div and re-attach to main_div.
            // But I don't know how to do it. So just set model and path
            // from sub_editor. This lost scroll position information, etc.
            // May be just restore scroll position is better than now.

            // var state = g_current.editor.saveViewState();

            mainEditor.editor.setModel(gCurrent.editor.getModel());
            mainEditor.path = gCurrent.path;

            // main_editor.restoreViewState(state);
        }
        mainEditor.editor.layout();
    };

    return {
        init: ()=>{},
        open: (path, data, abspath) => {
            menu.setPath(path);
            gCurrent.open(abspath, data);
        },
        reconnectWs: (ws) => {
            const initedKeys = Object.entries(mainEditor._services).filter(pair=>pair[1]._initialized).map(pair=>pair[0]);

            Object.values(mainEditor._services).forEach(svc => {svc._wsHandler = null; svc.dispose(); });

            connectToLanguageService(ws, languageServiceNS,
                ()=>{
                    Object.entries(mainEditor._services).filter(pair=>initedKeys.includes(pair[0])).forEach(pair=>pair[1].init());

                    mainEditor.bindLS(mainEditor.editor.getModel());
                    subEditor.bindLS(subEditor.editor.getModel());
                });

        }
    };
};

function initializeModule() {
    function onAmdEnabled() {
        require.config({paths:
            {vs: '/editor/vs', languageservice: '/editor/languageservice'}});
        require(['vs/editor/editor.main', 'languageservice'], function() {
            var args = Array.prototype.slice.call(arguments, 0);
            onInit.forEach(function(callback) {
                callback.apply(null, args);
            });
        });
    }
    if (typeof require !== 'undefined') {
        console.warn('initialized twice?');
        return;
    }
    var onInit = [];
    var loader = document.createElement('script');
    loader.src = '/editor/vs/loader.js';
    loader.type = 'text/javascript';
    loader.addEventListener('load', onAmdEnabled);
    document.head.appendChild(loader);
    return onInit;
}

function initializeLanguageServices(ws, languageservice, callback) {
    function onLanguageServiceList(ev) {
        var data = ev.data;
        if (data[0] !== '3') {
            return;
        }
        var handler = new languageservice.WsHandler(ws);
        var services = {};
        var msg = data.slice(1);
        if(msg != "") {
            JSON.parse(msg).forEach(function(params) {
                services[params.lang] =
                    languageservice.registerLanguageService(params, handler);
            });
        }
        ws.removeEventListener('message', onLanguageServiceList);
        callback(services, languageservice);
    }
    ws.addEventListener('message', onLanguageServiceList);
    // requesting language list.
    ws.send('3');
}

function notifyFocusChanged(editor) {
    gCurrent = editor;
    gMenu.setPath(editor.path);
}

// need to set
// - mehu.save()
// - menu.splitWindow = (main_div, sub_div) =>{}
// - menu.unsplitWindow = (main_div) => {}
function MonacoMenu() {
    var mainDiv = this.mainDiv = document.getElementById('main-div');
    var subDiv = this.subDiv = document.getElementById('sub-div');
    var menu = this;

    $('#save-button').click(function() {
        menu.save();
    });

    $('#split').change(function() {
        // eslint-disable-next-line no-invalid-this
        if(this.checked) {
            // split
            mainDiv.style.width = '50%';
            subDiv.style.visibility = 'visible';
            menu.splitWindow(mainDiv, subDiv);
        } else {
            // unsplit
            subDiv.style.visibility = 'hidden';
            mainDiv.style.width = '100%';
            menu.unsplitWindow(mainDiv);
        }
    });
}

MonacoMenu.prototype.getPath = () => {
    return $('#path-span').text();
};

MonacoMenu.prototype.setPath = (path) => {
    return $('#path-span').text(path);
};

MonacoMenu.prototype.setEnabled = (isEnable) => {
    $('#save-button').prop('disabled', !isEnable);
};

MonacoMenu.prototype.isSplit = () => {
    return $('#split').attr('checked');
};

function EditBookMonacoEditor(elem) {
    this.elem = elem;

    this.editor = null;
    this.path = null;
    this._services = null;
}

EditBookMonacoEditor.prototype.registerLangServices = function(services) {
    this._services = services;
};

function getExt(str) {
    var dot = str.lastIndexOf('.');

    if(dot == -1)
        return '';
    return str.substring(dot+1);
}

var langModeMap = {'re': 'markdown'};

function lookupLanguageMode(path) {
    var ext = getExt(path);
    if(ext in langModeMap) {
        return langModeMap[ext];
    }
    return null;  // null for auto detection
}

EditBookMonacoEditor.prototype.bindLS = function(model) {
    var lang = model.getModeId();
    if (lang in this._services) {
        var svc = this._services[lang];
        svc.onOpen(model);
        this.lservice = svc;
    }
} 

EditBookMonacoEditor.prototype.open = function(path, data) {
    if (!this.editor) {
        console.warn('editor is not loaded yet');
        return;
    }
    var uri = monaco.Uri.file(path);
    var model = monaco.editor.getModel(uri);
    if (!model) {
        var lang = lookupLanguageMode(path);
        model = monaco.editor.createModel(data, lang, uri);
        this.dirty = false;
        this.savedVersionId = model.getAlternativeVersionId();

        notifyModifyStatusChanged();
        this.lservice = {onChange: (a, b)=>{}};
        model.onDidChangeContent((change) => {
            var prevDirty = this.dirty;
            this.dirty = (
                this.savedVersionId !== model.getAlternativeVersionId());
            if(prevDirty != this.dirty) {
                notifyModifyStatusChanged();
            }

            this.lservice.onChange(model, change);
        });


        if (this._services === null) {
            console.warn('A file is opened before the language services are'
                + ' fully loaded. Consider reloading & waiting a bit.');
        } else {
            this.bindLS(model);
        }
    }


    this.editor.setModel(model);
    this.path = path;
};

EditBookMonacoEditor.prototype.save = function() {
    if (!this.editor) {
        return;
    }
    var model = this.editor.getModel();
    if (!model) {
        return;
    }

    var svc = this._services[model.getModeId()];
    if (svc) {
        svc.willSave(model);
    }
    // TODO: should use willSaveWaitUntil?
    // eslint-disable-next-line new-cap
    EditBook.saveFile(this.path, model.getValue(), () => {
        this.savedVersionId = model.getAlternativeVersionId();
        this.dirty = false;
        notifyModifyStatusChanged();

        toastr.info('saved');
        if (svc) {
            svc.didSave(model);
        }
    });
};

EditBookMonacoEditor.prototype.init = function() {
    this.editor = monaco.editor.create(this.elem);
    this.editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, ()=>this.save());
    this.editor.updateOptions({'theme': 'vs-dark'});
    this.editor.onDidFocusEditor(() => {
        notifyFocusChanged(this);
    });
};
