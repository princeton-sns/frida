mkfile_path := $(abspath $(lastword $(MAKEFILE_LIST)))
mkfile_dir := $(dir $(mkfile_path))
CLIENT_CORE="../../../../core/client/"

client: core_client
	cd ${mkfile_dir} && npm install

core_client: 
	cd ${CLIENT_CORE} && npm install

clean:
	cd ${CLIENT_CORE} && rm -rf node_modules
	cd ${mkfile_dir} && rm -rf node_modules

