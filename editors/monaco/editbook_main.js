'use strict';

var g_current;
var g_menu;

function NotifyModifyStatusChanged() {
    g_menu.setEnabled(g_current.dirty);
}

function EditBook_NewEditor(elem, ws) {
    document.body.style.margin = '0';
    var menu = new MonacoMenu(elem);

    var main_editor =  new EditBookMonacoEditor(menu.main_div);
    var sub_editor = new EditBookMonacoEditor(menu.sub_div);

    var onInit = InitializeModule();
    onInit.push(() => { main_editor.init(); });
    onInit.push(() => { sub_editor.init(); });
    onInit.push((_, languageservice) => {
        InitializeLanguageServices(ws, languageservice, function(services) {
            main_editor.registerLangServices(services);
            sub_editor.registerLangServices(services);
        });
    });

    g_current = main_editor;
    g_menu = menu;

    menu.save = () => g_current.save();
    menu.split_window = (main_div, sub_div) => { main_editor.editor.layout(); sub_editor.editor.layout();
         sub_editor.editor.setModel(main_editor.editor.getModel());
         sub_editor.path = main_editor.path;
         };
    menu.unsplit_window = (main_div) => {
        if(g_current != main_editor) {
            // we want to detach sub_editor from div and re-attach to main_div.
            // But I don't know how to do it. So just set model and path from sub_editor.
            // This lost scroll position information, etc. May be just restore scroll position is better than now.

            // var state = g_current.editor.saveViewState();

            main_editor.editor.setModel(g_current.editor.getModel());
            main_editor.path = g_current.path;

            // main_editor.restoreViewState(state);
        }
        main_editor.editor.layout();
    };

    return {
        init: ()=>{},
        open: (path, data, abspath) => {
            menu.setPath(path);
            g_current.open(abspath, data);
        }
    };
}

function InitializeModule() {
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

function InitializeLanguageServices(ws, languageservice, callback) {
    function onLanguageServiceList(ev) {
        var data = ev.data;
        if (data[0] !== '3') {
            return;
        }
        var handler = new languageservice.WsHandler(ws);
        var services = {};
        data.slice(1).split(',').forEach(function(lang) {
            services[lang] =
                languageservice.registerLanguageService(lang, handler);
        });
        ws.removeEventListener('message', onLanguageServiceList);
        callback(services);
    }
    ws.addEventListener('message', onLanguageServiceList);
    // requesting language list.
    ws.send('3');
}

function NotifyFocusChanged(editor) {
    g_current = editor;
    g_menu.setPath(editor.path);
}

// need to set
// - mehu.save()
// - menu.split_window = (main_div, sub_div) =>{}
// - menu.unsplit_window = (main_div) => {}
function MonacoMenu(holder) {
    var builder = [];
    builder.push(
'<button type="button" id="saveButton">Save</button> -- <input type="checkbox" id="split">split<br>',
'path: <span id="pathSpan"></span><br>',
// '<div id="mainDiv" style="position:absolute;top:50;left:0;bottom:0;right:0">',
'<div id="mainDiv" style="position:absolute;top:50;left:0;bottom:0;width:100%;overflow:hidden">',
// 'This is the test area.',
'</div>'
    );
    holder.html(builder.join(""));

    var main_div = document.getElementById("mainDiv"); // holder.find("#mainDiv");
    this.main_div = main_div;

    var sub_div = document.createElement("div");
    sub_div.style.cssText = "position: absolute; top:0px; bottom:0px";
    sub_div.style.overflow = 'hidden';
    sub_div.id = "subDiv";
    this.sub_div = sub_div;

    var menu = this;

    $("#saveButton").click(function() {
        menu.save();
    }
    );

    function resize(elem, left, top, width) {
        elem.style.width = width;
        elem.style.top = top;
        elem.style.left = left + "px";
    }

    $("#split").change(function() {
        if(this.checked) {
            // split
            holder.append(sub_div);

            var width = main_div.clientWidth;

            var editorWidth = width / 2;

            resize(main_div, 0, main_div.offsetTop, "50%");
            resize(sub_div, editorWidth, main_div.offsetTop, "50%");

            menu.split_window(main_div, sub_div);

        } else {
            // unsplit

            var width = main_div.clientWidth;

            $(sub_div).remove();
            resize(main_div, 0, main_div.top, "100%");

            menu.unsplit_window(main_div);
        }
    });

}

MonacoMenu.prototype.getPath = () => {
    return $("#pathSpan").text();
}

MonacoMenu.prototype.setPath = (path) => {
    return $("#pathSpan").text(path);
}

MonacoMenu.prototype.setEnabled = (isEnable) => {
    $("#saveButton").prop('disabled', !isEnable);
}

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
    var uri = monaco.Uri.from({scheme: 'file', path: path});
    var model = monaco.editor.getModel(uri);
    if (!model) {
        // second parameter is language -- which is null for
        // auto detection.
        model = monaco.editor.createModel(data, null, uri);
        this.dirty = false;
        this.savedVersionId = model.getAlternativeVersionId();
        
        NotifyModifyStatusChanged();
        this.lservice = {onChange: (a, b)=>{}};
        model.onDidChangeContent((change) => {
            var prev_dirty = this.dirty;
            this.dirty = this.savedVersionId !== model.getAlternativeVersionId();
            if(prev_dirty != this.dirty) {
                NotifyModifyStatusChanged();
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
    EditBook_SaveFile(this.path, model.getValue(), () => {
        this.savedVersionId = model.getAlternativeVersionId();
        this.dirty = false;
        NotifyModifyStatusChanged();

        toastr.info("saved");
        if (svc) {
            svc.didSave(model);
        }
    });
};

EditBookMonacoEditor.initializeModule = function() {
    var onInit = [];

};

EditBookMonacoEditor.prototype.init = function() {
    this.editor = monaco.editor.create(this.elem);
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KEY_S, ()=>this.save());
   this.editor.updateOptions({ 'theme' : 'vs-dark' });
    this.editor.onDidFocusEditor(() => { NotifyFocusChanged(this); });
};
