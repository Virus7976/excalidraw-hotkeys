# Prints the CHANGELOG.md section for version v, without its heading.
/^## / { on = ($2 == v); next }
on { print }
