define('editorservice', function() {
    function SimpleEditorService() {
		this.editors = [];
    }

	SimpleEditorService.prototype.add = function(editor) {
		this.editors.push(editor);
	}

	SimpleEditorService.prototype.openEditor = function(data) {
		return new Promise((resolve, reject) => {
            return this.doOpenEditor(data);
        });
	};

	SimpleEditorService.prototype.doOpenEditor = function(data) {
		let editor = this.find(data);
		if (!editor) {
			return null;
		}
		editor.focus();

		let selection = data.options.selection;
		if (selection) {
			if (typeof selection.endLineNumber === 'number' && typeof selection.endColumn === 'number') {
				editor.setSelection(selection);
				editor.revealRangeInCenter(selection, 1 /* immediate */);
			} else {
				let pos = {
					lineNumber: selection.startLineNumber,
					column: selection.startColumn
				};
				editor.setPosition(pos);
				editor.revealPositionInCenter(pos, 1 /* immediate */);
			}
		}

		return editor;
	};

	SimpleEditorService.prototype.find = function(data) {
		for (var i = 0; i < this.editors.length; i++) {
			let editor = this.editors[i];
			let model = editor.editor.getModel();
			if (model.uri.toString() === data.resource.toString()) {
				return editor.editor;
			}
		}
		let model = monaco.editor.getModel(data.resource);
		if (model) {
			gCurrent.editor.setModel(model);
			gCurrent.path = model.uri.path;
			return gCurrent.editor;
		}
		return null;
	};

    return SimpleEditorService;
})
