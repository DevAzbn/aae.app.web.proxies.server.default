'use strict';

process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';

var azbn = new require(__dirname + '/../../../../../../system/bootstrap')({
	
});

var app = azbn.loadApp(module);

var argv = require('optimist').argv;

azbn.setMdl('assert', require('assert'));
azbn.setMdl('http', require('http'));
azbn.setMdl('net', require('net'));
azbn.setMdl('url', require('url'));

azbn.setMdl('config', require('./config/main'));

azbn.mdl('config').port = argv.port || azbn.mdl('config').port || 3128;
azbn.mdl('config').proxy = argv.proxy || null; //var gateway = 'proxy://login:passwd@1.2.3.4:3128/' // Прокси для редиректа

if(azbn.mdl('config').proxy) {
	azbn.mdl('config').gateway = azbn.mdl('url').parse(azbn.mdl('config').proxy);
} else {
	azbn.mdl('config').gateway = null;
}

azbn.setMdl('server', azbn.mdl('http').createServer(function(request, response){
	
	var _url = request.url;
	
	// вывод в консоль адреса запроса
	app.log.debug('Req: %s', _url);
	
	// распарсенный запрос
	var ph = azbn.mdl('url').parse(_url);
	// распарсенный адрес прокси
	//var gw = azbn.mdl('url').parse(azbn.mdl('config').proxy);
	
	var options = {
		port : parseInt(ph.port),
		hostname : ph.hostname,
		method : request.method,
		path : ph.path,
		headers : request.headers || {},
	};
	
	if(azbn.mdl('config').gateway) {
		
		options.port = parseInt(azbn.mdl('config').gateway.port);
		options.hostname = azbn.mdl('config').gateway.hostname;
		options.path = _url;
		
		if(azbn.mdl('config').gateway.auth) {
			options.headers['Proxy-Authorization'] = 'Basic ' + new Buffer(azbn.mdl('config').gateway.auth).toString('base64');
		}
		
	}
	
	var gatewayRequest = azbn.mdl('http').request(options);
	
	gatewayRequest.on('error', function(err){
		
		app.log.error('Error(gatewayRequest, req, ' + _url + '): %s', err);
		//process.exit();
		
		response.end();
		
	});
	
	gatewayRequest.on('response', function(gatewayResponse){
		
		if(gatewayResponse.statusCode === 407){
			app.log.error('Gateway error: %s', 'AUTH REQUIRED');
			//process.exit();
			response.end();
		}
		
		gatewayResponse.on('data', function(chunk){
			response.write(chunk, 'binary');
		});
		
		gatewayResponse.on('end', function(){
			response.end();
		});
		
		response.writeHead(gatewayResponse.statusCode, gatewayResponse.headers);
		
	});
	
	request.on('data', function(chunk){
		gatewayRequest.write(chunk, 'binary');
	});
	
	request.on('end', function(){
		gatewayRequest.end();
	});
	
	gatewayRequest.end();
	
}).on('connect', function(request, socketRequest, head){
	
	// вывод в консоль адреса запроса
	
	var _url = request.url;
	
	app.log.debug('Con: %s', _url);
	
	var ph = azbn.mdl('url').parse('http://' + _url);
	
	var options = {
		port : parseInt(ph.port),
		hostname : ph.hostname,
		method : 'CONNECT',
		path : ph.hostname + ':' + (ph.port || 80),
		headers : request.headers || {},
	};
	
	//console.log(options);
	
	if(azbn.mdl('config').gateway) {
		
		options.port = parseInt(azbn.mdl('config').gateway.port);
		options.hostname = azbn.mdl('config').gateway.hostname;
		
		if(azbn.mdl('config').gateway.auth) {
			options.headers['Proxy-Authorization'] = 'Basic ' + new Buffer(azbn.mdl('config').gateway.auth).toString('base64');
		}
		
		var gatewayRequest = azbn.mdl('http').request(options);
		
		gatewayRequest.on('error', function(err){
			
			app.log.error('Error(gatewayRequest, con, ' + _url + '): %s', err);
			//process.exit();
			
			socketRequest.write('HTTP/' + request.httpVersion + ' 500 Connection error\r\n\r\n');
			socketRequest.end();
			
			//gatewayRequest.end();
			
		});
		
		gatewayRequest.on('connect', function(res, socket, head){
			
			//azbn.mdl('assert').equal(res.statusCode, 200);
			//azbn.mdl('assert').equal(head.length, 0);
			
			socketRequest.write('HTTP/' + request.httpVersion + ' 200 Connection established\r\n\r\n');
			
			// Туннелирование к хосту
			socket.on('data', function(chunk){
				socketRequest.write(chunk, 'binary');
			});
			
			socket.on('end', function(){
				socketRequest.end();
			});
			
			socket.on('error', function() {
				// Сказать клиенту, что произошла ошибка
				socketRequest.write('HTTP/' + request.httpVersion + ' 500 Connection error\r\n\r\n');
				socketRequest.end();
			});
			
			// Туннелирование к клиенту
			socketRequest.on('data', function(chunk) {
				socket.write(chunk, 'binary');
			});
			
			socketRequest.on('end', function(){
				socket.end();
			});
			
			socketRequest.on('error', function(){
				socket.end();
			});
			
		}).end();
		
	} else {
		
		var socket = azbn.mdl('net').connect(options.port, options.hostname, function() {
			socket.write(head);
			socketRequest.write('HTTP/' + request.httpVersion + ' 200 Connection established\r\n\r\n');
		})
		
		socket.on('data', function(chunk){
			socketRequest.write(chunk);
		});
		
		socket.on('end', function(){
			socketRequest.end();
		});
		
		socket.on('error', function(){
			socketRequest.write('HTTP/' + request.httpVersion + ' 500 Connection error\r\n\r\n');
			socketRequest.end();
		});
		
		// Туннелирование к клиенту
		socketRequest.on('data', function(chunk){
			socket.write(chunk);
		});
		
		socketRequest.on('end', function(){
			socket.end();
		});
		
		socketRequest.on('error', function() {
			socket.end();
		});
		
	}
	
}).listen(azbn.mdl('config').port));

app.log.debug('Run proxy port on: %s', azbn.mdl('config').port);