'use strict';

var g_current;
var g_menu;

function EditBook_NewEditor(elem, ws) {
    document.body.style.margin = '0';
    var menu = new MonacoMenu(elem);

    var main_editor =  new EditBookMonacoEditor(menu.main_div);
    var sub_editor = new EditBookMonacoEditor(menu.sub_div);

    main_editor.init();
    sub_editor.init();

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
        open: (path, data) => { menu.setPath(path); g_current.open(path, data);  }
    };
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
        toastr.info("saved");
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

function EditBookMonacoEditor(elem) {
    this.elem = elem;

    this.editor = null;
    this.path = null;
}

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
    
    EditBook_SaveFile(this.path, model.getValue(), function() {});
};

EditBookMonacoEditor.prototype.init = function() {
    var self = this;
    function onAmdEnabled() {
        require.config({paths: {vs: "/editor/vs"}});
        require(['vs/editor/editor.main'], function() {
            self.editor = monaco.editor.create(self.elem);
            self.editor.updateOptions({ 'theme' : 'vs-dark' });
            self.editor.onDidFocusEditor(() => { NotifyFocusChanged(self); });
        });
    }
    if (typeof require !== 'undefined') {
        onAmdEnabled();
    } else {
        var loader = document.createElement('script');
        loader.src = '/editor/vs/loader.js';
        loader.type = 'text/javascript';
        loader.addEventListener('load', onAmdEnabled);
        document.head.appendChild(loader);
    }
};
