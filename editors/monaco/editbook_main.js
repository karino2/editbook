'use strict';

var gCurrent;
var gMenu;

function notifyModifyStatusChanged() {
    gMenu.setEnabled(gCurrent.dirty);
}

// eslint-disable-next-line no-unused-vars
EditBook.newEditor = function(elem, ws) {
    document.body.style.margin = '0';
    var menu = new MonacoMenu(elem);
    var mainEditor = new EditBookMonacoEditor(menu.mainDiv);
    var subEditor = new EditBookMonacoEditor(menu.subDiv);

    var onInit = initializeModule();
    onInit.push(() => mainEditor.init());
    onInit.push(() => subEditor.init());
    onInit.push((_, languageservice) => {
        initializeLanguageServices(ws, languageservice, function(services) {
            mainEditor.registerLangServices(services);
            subEditor.registerLangServices(services);
        });
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
        JSON.parse(data.slice(1)).forEach(function(params) {
            services[params.lang] =
                languageservice.registerLanguageService(params, handler);
        });
        ws.removeEventListener('message', onLanguageServiceList);
        callback(services);
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
function MonacoMenu(holder) {
    var builder = [];
    builder.push(
'<button type="button" id="saveButton">Save</button> ' +
'-- <input type="checkbox" id="split">split<br>',
'path: <span id="pathSpan"></span><br>',
'<div id="mainDiv" ' +
'style="position:absolute;top:50;left:0;bottom:0;width:100%;overflow:hidden">',
'</div>'
    );
    holder.html(builder.join(''));

    var mainDiv = document.getElementById('mainDiv');
    this.mainDiv = mainDiv;

    var subDiv = document.createElement('div');
    subDiv.style.cssText = 'position: absolute; top:0px; bottom:0px';
    subDiv.style.overflow = 'hidden';
    subDiv.id = 'subDiv';
    this.subDiv = subDiv;

    var menu = this;

    $('#saveButton').click(function() {
        menu.save();
    }
    );

    function resize(elem, left, top, width) {
        elem.style.width = width;
        elem.style.top = top;
        elem.style.left = left + 'px';
    }

    $('#split').change(function() {
        // eslint-disable-next-line no-invalid-this
        if(this.checked) {
            // split
            holder.append(subDiv);

            var width = mainDiv.clientWidth;

            var editorWidth = width / 2;

            resize(mainDiv, 0, mainDiv.offsetTop, '50%');
            resize(subDiv, editorWidth, mainDiv.offsetTop, '50%');

            menu.splitWindow(mainDiv, subDiv);
        } else {
            // unsplit

            var width = mainDiv.clientWidth;

            $(subDiv).remove();
            resize(mainDiv, 0, mainDiv.top, '100%');

            menu.unsplitWindow(mainDiv);
        }
    });
}

MonacoMenu.prototype.getPath = () => {
    return $('#pathSpan').text();
};

MonacoMenu.prototype.setPath = (path) => {
    return $('#pathSpan').text(path);
};

MonacoMenu.prototype.setEnabled = (isEnable) => {
    $('#saveButton').prop('disabled', !isEnable);
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

EditBookMonacoEditor.prototype.open = function(path, data) {
    if (!this.editor) {
        console.warn('editor is not loaded yet');
        return;
    }
    var uri = monaco.Uri.file(path);
    var model = monaco.editor.getModel(uri);
    if (!model) {
        // second parameter is language -- which is null for
        // auto detection.
        model = monaco.editor.createModel(data, null, uri);
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
            var lang = model.getModeId();
            if (lang in this._services) {
                var svc = this._services[lang];
                svc.onOpen(model);
                this.lservice = svc;
            }
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
