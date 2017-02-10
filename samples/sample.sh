alias ebserver="editbook --port 51234"

function ebclient() {
	abs=`realpath $1`
	editbook --client $abs
}
