let create = (tag, props) => Object.assign(document.createElement(tag), props);

function init(node, nodes = []) {
	node.replaceChildren(...nodes);
	return node;
}

class SARIFToHTMLConverter {
    constructor({hooks} = {}) {
        this.context = {
            related_locations_map: undefined,
            rules_map: undefined,
        };

        this.hooks = hooks;
    }

    map(arr, fn) {
        if (arr == null) {
            return [];
        }

        return arr.map(fn.bind(this));
    }

    render(sarif_log) {
        const elem = create('div', {className: 'sarif-log'});

        return init(elem, this.map(sarif_log.runs, this.render_run));
    }

    render_artifact_location(artifact_location) {
        const elem = create('span', {className: 'sarif-artifact-location'});

        const uri = artifact_location.uri;
        const final_uri = this.hooks?.hook_filename?.(uri) ?? uri;

        return init(elem, [final_uri]);
    }

    render_location(loc) {
        const create_location_info = (loc) => {
            if (loc.message) {
                return create('details', {className: 'sarif-location', open: true});
            } else {
                return create('div', {className: 'sarif-location'});
            }
        };
        const elem = create_location_info(loc);

        if (loc.message) {
            const message_text_info = init(create('summary'), [this.render_message(loc.message)]);
            elem.append(message_text_info);
        }

        if (loc.relationships) {
            const inclusion_chain = this.render_relationships(loc.relationships);
            elem.append(inclusion_chain);
        }

        if (loc.physicalLocation) {
            const physical_location_info = this.render_physical_location(loc.physicalLocation);
            elem.append(physical_location_info);
        }

        return elem;
    }

    render_message(message) {
        const original_text = message.text;

        const text = original_text.replaceAll(/\{\{|\}\}|\{(\d+)\}/g, (m, p1) => {
            if (p1) {
                return message.arguments[p1];
            } else {
                return m[0];
            }
        });

        const final_text = this.hooks?.hook_message_text?.(text) ?? text;

        return init(create('span', {className: 'sarif-message-text'}), [final_text]);
    }

    render_physical_location(loc) {
        const elem = create('div', {className: 'sarif-physical-location'});

        const loc_info = create('div', {className: 'sarif-source-location'});
        init(elem, [loc_info]);

        const artifact_location_info = this.render_artifact_location(loc.artifactLocation);
        init(loc_info, [artifact_location_info]);

        const region = loc.region;
        const context_region = loc.contextRegion;

        if (region) {
            if (region.startLine) {
                const start_line_info = create('span', {className: 'sarif-location-start-line'});
                init(start_line_info, [region.startLine]);
                loc_info.append(':', start_line_info);

                if (region.startColumn) {
                    const start_column_info = create('span', {className: 'sarif-location-start-column'});
                    init(start_column_info, [region.startColumn]);
                    loc_info.append(':', start_column_info);
                }
            }
        }

        const ctx_region = region?.snippet ? region : context_region;
        if (ctx_region?.snippet) {
            const text = ctx_region.snippet.text.replaceAll('\t', '        ');
            const location_info = create('pre', {className: 'sarif-context-snippet'});

            if (region && region.startLine) {
                const start_line_offset = region.startLine - ctx_region.startLine;
                const end_line_offset = region.endLine ? region.endLine - ctx_region.startLine : start_line_offset;
                const start_column_offset = region.startColumn ? region.startColumn - 1 : 0;
                const end_column_offset = region.endColumn ? region.endColumn - 1 : text.length;

                const lines = text.split('\n');

                const before_highlight = create('span');
                const highlight = create('mark', {className: 'sarif-snippet-region'});
                const after_highlight = create('span');

                const lines_before_highlight = lines.slice(0, start_line_offset);
                const text_before_highlight = lines[start_line_offset].slice(0, start_column_offset);
                init(before_highlight, [...lines_before_highlight.map(x => `${x}\n`), text_before_highlight]);

                if (start_line_offset === end_line_offset) {
                    const highlighted_text = lines[start_line_offset].slice(start_column_offset, end_column_offset);
                    init(highlight, [highlighted_text]);
                } else {
                    const first_line = lines[start_line_offset].slice(start_column_offset);
                    const middle_lines = lines.slice(start_line_offset + 1, end_line_offset);
                    const last_line = lines[end_line_offset].slice(0, end_column_offset);
                    init(highlight, [`${first_line}\n`, ...middle_lines.map(x => `${x}\n`), last_line]);
                }

                const text_after_highlight = lines[end_line_offset].slice(end_column_offset);
                const lines_after_highlight = lines.slice(end_line_offset + 1);
                init(after_highlight, [`${text_after_highlight}\n`, ...lines_after_highlight.join('\n')]);

                init(location_info, [before_highlight, highlight, after_highlight]);
            } else {
                init(location_info, [text]);
            }

            elem.append(location_info);
        }

        return elem;
    }

    render_relationships(relationships) {
        const elem = create('div', {className: 'sarif-relationships'});

        for (const relationship of relationships) {
            if (relationship.kinds.some(x => x === 'isIncludedBy')) {
                const target = this.context.related_locations_map.get(relationship.target);

                if (target.physicalLocation) {
                    const inclusion = create('div', {className: 'sarif-location-inclusion'});
                    const loc_info = this.render_physical_location(target.physicalLocation);
                    init(inclusion, ['Included from here: ', loc_info]);
                    elem.append(inclusion);

                    if (target.relationships) {
                        const target_relationship_info = this.render_relationships(target.relationships);
                        elem.append(target_relationship_info);
                    }
                }
            }
        }

        return elem;
    }

    render_run(run) {
        const elem = create('details', {className: 'sarif-run', open: true});

        const tool_info = init(create('summary'), [this.render_tool(run.tool)]);
        const results_info = create('div', {className: 'sarif-run-results'});

        for (const result of run.results ?? []) {
            const result_info = this.render_run_result(result);
            results_info.append(result_info);
        }

        this.context.rules_map = undefined;

        return init(elem, [tool_info, results_info]);
    }

    render_run_result(run_result) {
        const elem = create('div', {className: 'sarif-run-result'});

        const level = run_result.level ?? 'warning';
        if (['none', 'note', 'warning', 'error'].includes(level)) {
            elem.classList.add(`sarif-level-${level}`);
        }

        const rule_id = run_result.ruleId;
        const rule = this.context.rules_map?.get(rule_id);

        const primary_info = create('div', {className: 'sarif-message-primary'});
        const message_category_info = create('details', {className: 'sarif-message-category', open: true});
        const level_info = init(create('summary', {className: 'sarif-message-level'}), [level]);
        init(message_category_info, [level_info]);

        if (!(level === 'error' && rule_id === 'error' && !rule)) {
            const rule_id_info = create('span', {className: 'sarif-message-rule-id'});
            const rule_help_link = init(create('a'), [rule_id]);
            if (rule?.helpUri) {
                rule_help_link.href = rule.helpUri;
            }
            init(rule_id_info, [' [', rule_help_link, '] ']);
            message_category_info.append(rule_id_info);
        }

        const related_locations = run_result.relatedLocations ?? [];

        this.context.related_locations_map = new Map(related_locations.map(x => [x.id, x]));

        const message_info = create('details', {className: 'sarif-message', open: true});
        const message_text_info = init(create('summary'), [this.render_message(run_result.message)]);
        const location_info = this.map(run_result.locations, this.render_location);
        init(message_info, [message_text_info, ...location_info]);
        init(primary_info, [message_category_info, message_info]);

        init(elem, [primary_info]);

        const stack = [{child_loc: undefined, elem, nesting_level: 0}];
        for (const related_location of related_locations) {
            const inner_elem = create('div', {className: 'sarif-related-location'});

            const inner_primary_info = create('div', {className: 'sarif-message-primary'});
            const rendered = this.render_location(related_location);
            init(inner_primary_info, [rendered]);

            init(inner_elem, [inner_primary_info]);

            const nesting_level = related_location.properties?.nestingLevel;

            const get_child_location_info = (info) => {
                if (!info.child_loc) {
                    const child_loc_container = create('details', {className: 'sarif-message-secondary', open: true});
                    const child_loc_info = create('div');
                    init(child_loc_container, [create('summary'), child_loc_info]);
                    info.elem.append(child_loc_container);
                    info.child_loc = child_loc_info;
                }

                return info.child_loc;
            };

            if (nesting_level) {
                rendered.dataset.nesting_level = nesting_level;
                while (stack.length > 1 && nesting_level <= stack.at(-1).nesting_level) {
                    stack.pop();
                }

                const child_location_info = get_child_location_info(stack.at(-1));
                child_location_info.append(inner_elem);

                stack.push({child_loc: undefined, elem: inner_elem, nesting_level});
            } else if (related_location.message) {
                const child_location_info = get_child_location_info(stack[0]);
                child_location_info.append(inner_elem);
            }
        }

        this.context.related_locations_map = undefined;

        return elem;
    }

    render_tool(tool) {
        return this.render_tool_component(tool.driver);
    }

    render_tool_component(tool_component) {
        this.context.rules_map = new Map(this.map(tool_component.rules, x => [x.id, x]));
        return init(create('span', {className: 'sarif-tool-component'}), [tool_component.name]);
    }
}

export function sarif_to_html(sarif_log) {
    const renderer = new SARIFToHTMLConverter();

    return renderer.render(sarif_log);
}
