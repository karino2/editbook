'use strict';

EditBook.newEditor = function(ws) {
    return {
        init: function() { initEditor(); },
        open: function(path, data) { open(path, data); }
    }
}

function open(path, data) {
    console.log("editor.open called", path);
    
    $("#path-span").text(path)
    $("#editorTextArea").val(data)
    console.log("open:" + path)
}

function initEditor() {
    $('#main-div').html(
        '<textarea id="editor-textarea" cols="100" rows="40">' +
        'This is the test area.' +
        '</textarea>'
    );
    $('#split').prop('disabled', true);
    $("#save-button").click(function() {
        EditBook.saveFile($("#path-span").text(),
                $("#editor-textarea").val(),
                function(){alert("saved")}
                );
    });



}

