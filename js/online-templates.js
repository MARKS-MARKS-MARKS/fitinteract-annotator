(function (namespace) {
  "use strict";

  function templateLabel(template) {
    const code = template.code ? "[" + template.code + "] " : "";
    const category = template.category ? template.category + " - " : "";
    return code + category + template.name;
  }

  function fillSelect(select, templates, placeholder) {
    select.textContent = "";
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = placeholder;
    select.appendChild(empty);
    templates.forEach((template) => {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = templateLabel(template);
      select.appendChild(option);
    });
  }

  class OnlineTemplateService {
    constructor() {
      this.client = namespace.Cloud.getClient();
      this.queryTemplates = [];
      this.textTemplates = [];
      this.bound = false;
    }

    async load() {
      const [queries, texts] = await Promise.all([
        this.client.from("query_templates")
          .select("id,code,category,name,text,enabled,sort_order,updated_at")
          .eq("enabled", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true }),
        this.client.from("text_templates")
          .select("id,code,category,name,text,enabled,sort_order,updated_at")
          .eq("enabled", true)
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
      ]);
      if (queries.error) throw new Error("Query 模板加载失败：" + queries.error.message);
      if (texts.error) throw new Error("Text 模板加载失败：" + texts.error.message);
      this.queryTemplates = queries.data || [];
      this.textTemplates = texts.data || [];
      this.render();
      this.bind();
      return { queryTemplates: this.queryTemplates, textTemplates: this.textTemplates };
    }

    render() {
      fillSelect(document.getElementById("query-preset-select"), this.queryTemplates, "选择统一 Query 模板");
      fillSelect(document.getElementById("text-preset-select"), this.textTemplates, "选择统一 Text 模板");
    }

    bind() {
      if (this.bound) return;
      this.bound = true;
      document.getElementById("query-preset-select").addEventListener("change", (event) => {
        const template = this.queryTemplates.find((item) => item.id === event.target.value);
        if (!template) return;
        const input = document.getElementById("query-text");
        input.value = template.text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      document.getElementById("text-preset-select").addEventListener("change", (event) => {
        const template = this.textTemplates.find((item) => item.id === event.target.value);
        if (!template) return;
        const input = document.getElementById("annotation-text");
        input.value = template.text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  }

  namespace.OnlineTemplateService = OnlineTemplateService;
  namespace.formatTemplateLabel = templateLabel;
})(window.FitInteract = window.FitInteract || {});
