describe("Warning", function () {
  beforeEach(function () {
    jasmine.Ajax.install();
  });

  afterEach(function () {
    this.puppet.unobserve();
    jasmine.Ajax.uninstall();
  });

  /// init
  describe("when the root path is patched", function () {
    it("should show a warning when debug=true", function (done) {
      var consoleSpy = spyOn(window.console, 'warn');
      var obj;

      this.puppet = new Puppet('/test', function (myObj) {
        obj = myObj;
      });

      jasmine.Ajax.requests.mostRecent().response({
        "status": 200,
        "contentType": 'application/json',
        "responseText": '{"hello": "world"}'
      });

      obj.hello = "galaxy";
      triggerMouseup();

      setTimeout(function () {
        jasmine.Ajax.requests.mostRecent().response({
          "status": 200,
          "contentType": 'application/json-patch+json',
          "responseText": '[{"op":"replace","path":"/","value":{"hello": "universe"}}]'
        });
        //expect(obj.hello).toBe("universe"); //TODO JSON-Patch does not apply such patch correctly as of version 0.3.7
        expect(consoleSpy.calls.count()).toBe(1);
        expect(consoleSpy.calls.argsFor(0)[0]).toBe('PuppetJs warning: Server pushed patch that replaces the object root ([{"op":"replace","path":"/","value":{"hello":"universe"}}])');
        done();
      }, 0);
    });

    it("should not show a warning when debug=false", function (done) {
      var consoleSpy = spyOn(window.console, 'warn');
      var obj;

      this.puppet = new Puppet('/test', function (myObj) {
        obj = myObj;
      });
      this.puppet.debug = false;

      jasmine.Ajax.requests.mostRecent().response({
        "status": 200,
        "contentType": 'application/json',
        "responseText": '{"hello": "world"}'
      });

      obj.hello = "galaxy";
      triggerMouseup();

      setTimeout(function () {
        jasmine.Ajax.requests.mostRecent().response({
          "status": 200,
          "contentType": 'application/json-patch+json',
          "responseText": '[{"op":"replace","path":"/","value":{"hello": "universe"}}]'
        });
        //expect(obj.hello).toBe("universe"); //TODO JSON-Patch does not apply such patch correctly as of version 0.3.7
        expect(consoleSpy.calls.count()).toBe(0);
        done();
      }, 0);
    });
  });
});