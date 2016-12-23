
function EditBook_NewEditor(div, ws) {
    return {
        init: function() { initEditor(div); },
        open: function(path, data) { open(path, data); }
    }
}

var g_extModeMap = {
    "m": "matlab",
};


function getExt(str) {
    var dot = str.lastIndexOf(".");

    if(dot == -1)
        return "";
    return str.substring(dot+1);
}

function open(path, data) {
    console.log("editor.open called", path);
    
    $("#pathSpan").text(path)

    var editr = g_current;

    var session = new EditSession("")
    editr.setSession(session);
    editr.setValue(data, -1)
    editr.path = path;

    var ext = getExt(path);
    if(ext in g_extModeMap) {
         editr.getSession().setMode("ace/mode/" + g_extModeMap[ext]);
    } else {
         editr.getSession().setMode("ace/mode/text");
    }

    console.log("open:" + path)
}



g_offsetTop = 50;

function initEditor(div) {
    var builder = [];
    builder.push(
'<button type="button" id="saveButton">Save</button> -- <input type="checkbox" id="split">split<br>',
'path: <span id="pathSpan"></span><br>',
'<div id="aceDiv" style="position:absolute;top:50;left:0;bottom:0;right:0">',
'This is the test area.',
'</div>'
    );
    div.html(builder.join(""));
    g_container = div;

    $("#saveButton").click(function() {
        EditBook_SaveFile($("#pathSpan").text(),
            g_ace.getValue(),
            function(){toastr.info("saved"); }
        );
    });

    function resize(editor, top, width, height) {
        editor.container.style.width = width + "px";
        editor.container.style.top = top + "px";
        editor.container.style.left = "0px";
        editor.container.style.height = height + "px";
        editor.resize();
    }

    $("#split").change(function() {
        if(this.checked) {
            // split
            toastr.info("splited");
            g_container.append(g_subeditor.container);

            var width = g_ace.container.clientWidth;
            var height = g_ace.container.clientHeight;

            var editorHeight = height / 2;

            resize(g_ace, g_offsetTop, width, editorHeight);
            resize(g_subeditor, g_offsetTop+ editorHeight, width, editorHeight);


            var session = g_ace.session;
            session = cloneSession(session);
            g_subeditor.setSession(session);

            g_subeditor.path = g_ace.path;

        } else {
            // unsplit
            toastr.info("unsplited")

            var width = g_ace.container.clientWidth;
            var height = g_ace.container.clientHeight;

            $(g_subeditor.container).remove();
            resize(g_ace, g_offsetTop, width, height*2);
        }
    });

    // refer this folder as /editor/
    $.getScript("/editor/src-min-noconflict/ace.js", function(d, t, xhr)
    {


        ace.config.set("basePath", "/editor/src-min-noconflict");
        EditSession = ace.require("ace/edit_session").EditSession;
        UndoManager = ace.require("ace/undomanager").UndoManager;
        Editor = ace.require("ace/editor").Editor
        Renderer = ace.require("ace/virtual_renderer").VirtualRenderer;
        g_lang = ace.require("ace/lib/lang");

        g_ace = ace.edit("aceDiv");
        g_current = g_ace;
        g_theme = "ace/theme/tomorrow_night_bright";
        g_ace.setTheme(g_theme);
        g_ace.path = "";
        g_ace.on("focus", function() {
            g_current = g_ace;
            $("#pathSpan").text(g_current.path);
        });

        var el = document.createElement("div");
        el.style.cssText = "position: absolute; top:0px; bottom:0px";
        // g_container.appendChild(el);
        // var session = new EditSession("");
        g_subeditor = new Editor(new Renderer(el, g_theme));
        g_subeditor.on("focus", function() {
            g_current = g_subeditor;
            $("#pathSpan").text(g_current.path);
        })
    });



}


function UndoManagerProxy(undoManager, session) {
    this.$u = undoManager;
    this.$doc = session;
}

(function() {
    this.execute = function(options) {
        this.$u.execute(options);
    };

    this.undo = function() {
        var selectionRange = this.$u.undo(true);
        if (selectionRange) {
            this.$doc.selection.setSelectionRange(selectionRange);
        }
    };

    this.redo = function() {
        var selectionRange = this.$u.redo(true);
        if (selectionRange) {
            this.$doc.selection.setSelectionRange(selectionRange);
        }
    };

    this.reset = function() {
        this.$u.reset();
    };

    this.hasUndo = function() {
        return this.$u.hasUndo();
    };

    this.hasRedo = function() {
        return this.$u.hasRedo();
    };
}).call(UndoManagerProxy.prototype);


function cloneSession(session) {
    var s = new EditSession(session.getDocument(), session.getMode());

    var undoManager = session.getUndoManager();
    if (undoManager) {
        var undoManagerProxy = new UndoManagerProxy(undoManager, s);
        s.setUndoManager(undoManagerProxy);
    }
    s.$informUndoManager = g_lang.delayedCall(function() { s.$deltas = []; });
    s.setTabSize(session.getTabSize());
    s.setUseSoftTabs(session.getUseSoftTabs());
    s.setOverwrite(session.getOverwrite());
    s.setBreakpoints(session.getBreakpoints());
    s.setUseWrapMode(session.getUseWrapMode());
    s.setUseWorker(session.getUseWorker());
    s.setWrapLimitRange(session.$wrapLimitRange.min,
                        session.$wrapLimitRange.max);
    s.$foldData = session.$cloneFoldData();

    return s;
}
