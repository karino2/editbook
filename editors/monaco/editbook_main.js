function EditBook_NewEditor(elem, ws) {
    document.body.style.margin = '0';
    return new EditBookMonacoEditor(elem);
}

function EditBookMonacoEditor(elem) {
    elem = elem[0];
    var button = document.createElement('button');
    button.onclick = this.save.bind(this);
    button.textContent = 'Save';
    button.style.margin = '5px 5px 5px 5px';
    elem.appendChild(button);

    this.elem = document.createElement('div');
    this.elem.style.position = 'absolute';
    this.elem.style.top = '50px';
    this.elem.style.bottom = '0';
    this.elem.style.width = '100%';
    this.elem.style.overflow = 'hidden';
    elem.appendChild(this.elem);

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
