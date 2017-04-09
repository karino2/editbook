'use strict';

EditBook.newEditor = function(ws) {
    return {
        init: function() { initEditor(); },
        open: function(path, data) { open(path, data); }
    }
}

var ace_extModeMap = {
    "m": "matlab",
    "java": "java",
    "c": "c_cpp",
    "cpp": "c_cpp",
    "cc": "c_cpp",
    "h" : "c_cpp"
};


function getExt(str) {
    var dot = str.lastIndexOf(".");

    if(dot == -1)
        return "";
    return str.substring(dot+1);
}

function open(path, data) {
    console.log("editor.open called", path);
    
    $("#path-span").text(path)

    var editr = ace_current;

    var session = new EditSession("")
    editr.setSession(session);
    editr.setValue(data, -1);
    editr.path = path;
    editr.getSession().setUndoManager(new UndoManager());


    var ext = getExt(path);
    if(ext in ace_extModeMap) {
         editr.getSession().setMode("ace/mode/" + ace_extModeMap[ext]);
    } else {
         editr.getSession().setMode("ace/mode/text");
    }

    console.log("open:" + path)
}

var ace_offsetTop = 50;
var ace_current;
var ace_editor;
var ace_subeditor;
var ace_lang;
var ace_theme;
var EditSession;
var UndoManager;
var Editor;
var Renderer;


function initEditor() {
    $("#save-button").click(function() {
        EditBook.saveFile($("#path-span").text(),
            ace_current.getValue(),
            function(){toastr.info("saved"); }
        );
    });

    $("#split").change(function() {
        var mainDiv = document.getElementById('main-div');
        var subDiv = document.getElementById('sub-div');
        if(this.checked) {
            // split
            mainDiv.style.width = '50%';
            subDiv.style.visibility = 'visible';

            var session = ace_editor.session;
            session = cloneSession(session);
            ace_subeditor.setSession(session);

            ace_subeditor.path = ace_editor.path;
        } else {
            // unsplit
            ace_editor.setSession(ace_current.getSession());
            ace_current = ace_editor;
            subDiv.style.visibility = 'hidden';
            mainDiv.style.width = '100%';
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
        ace_lang = ace.require("ace/lib/lang");

        ace_editor = ace.edit("main-div");
        ace_current = ace_editor;
        ace_theme = "ace/theme/tomorrow_night_bright";
        ace_editor.setTheme(ace_theme);
        ace_editor.path = "";
        ace_editor.on("focus", function() {
            ace_current = ace_editor;
            $("#path-span").text(ace_current.path);
        });
        ace_subeditor = ace.edit("sub-div");
        ace_subeditor.setTheme(ace_theme);
        ace_subeditor.on("focus", function() {
            ace_current = ace_subeditor;
            $("#path-span").text(ace_current.path);
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
    s.$informUndoManager = ace_lang.delayedCall(function() { s.$deltas = []; });
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
