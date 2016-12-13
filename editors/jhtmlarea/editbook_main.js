
function EditBook_NewEditor(div, ws) {
    return {
        init: function() { initEditor(div); },
        open: function(path, data) { open(path, data); }
    }
}

function open(path, data) {
    console.log("editor.open called", path);
    
    $("#pathSpan").text(path)
    // $("#editorTextArea").val(data)
    $("#editorTextArea").html(data)
    console.log("open:" + path)
}

function initEditor(div) {
    var builder = [];
    builder.push(
'<button type="button" id="saveButton">Save</button><br>',
'path: <span id="pathSpan"></span><br>',
'<textarea id="editorTextArea" cols="100" rows="40">',
'This is the test area.',
'</textarea>'
    );
    div.html(builder.join(""));

    $("#saveButton").click(function() {
        EditBook_SaveFile($("#pathSpan").text(),
                $("#editorTextArea").val(),
                function(){alert("saved")}
                );
    });

    // refer this folder as /editor/
    $.getScript("/editor/jHtmlArea-0.8.min.js", function(d, t, xhr){
            $("#editorTextArea").htmlarea();
    });

    $("<link/>", {
    rel: "stylesheet",
    type: "text/css",
    href: "/editor/style/jHtmlArea.css"
    }).appendTo("head");


}

