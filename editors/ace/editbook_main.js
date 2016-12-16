
function EditBook_NewEditor(div, ws) {
    return {
        init: function() { initEditor(div); },
        open: function(path, data) { open(path, data); }
    }
}

function open(path, data) {
    console.log("editor.open called", path);
    
    $("#pathSpan").text(path)
    g_ace.setValue(data)
    console.log("open:" + path)
}



function initEditor(div) {
    var builder = [];
    builder.push(
'<button type="button" id="saveButton">Save</button><br>',
'path: <span id="pathSpan"></span><br>',
'<div id="aceDiv" style="position:absolute;top:50;left:0;bottom:50;right:0">',
'This is the test area.',
'</div>'
    );
    div.html(builder.join(""));

    $("#saveButton").click(function() {
        EditBook_SaveFile($("#pathSpan").text(),
            g_ace.getValue(),
            function(){toastr.info("saved"); }
        );
    });

    // refer this folder as /editor/
    $.getScript("/editor/src-min-noconflict/ace.js", function(d, t, xhr)
    {
        ace.config.set("basePath", "/editor/src-min-noconflict");
        g_ace = ace.edit("aceDiv");
        g_ace.setTheme("ace/theme/monokai")
    });



}

