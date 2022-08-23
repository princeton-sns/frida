mkfile_path := $(abspath $(lastword $(MAKEFILE_LIST)))
mkfile_dir := $(dir $(mkfile_path))
SERVER_CORE="../../../../core/server/"

server: core_server
	cd ${mkfile_dir} && npm install

core_server: 
	cd ${SERVER_CORE} && npm install

clean:
	cd ${SERVER_CORE} && rm -rf node_modules
	cd ${mkfile_dir} && rm -rf node_modules

