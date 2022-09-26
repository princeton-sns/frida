mkfile_path := $(abspath $(lastword $(MAKEFILE_LIST)))
mkfile_dir := $(dir $(mkfile_path))
CLIENT_CORE="./core/client/index.js"

all_methods:
	node_modules/.bin/jsdoc --access all ${CLIENT_CORE}
	mv out doc

public:
	node_modules/.bin/jsdoc ${CLIENT_CORE}
	mv out doc

private:
	node_modules/.bin/jsdoc --access private ${CLIENT_CORE}
	mv out doc

install: 
	npm i jsdoc --save-dev

uninstall:
	rm -rf node_modules

clean:
	rm -rf doc
