/**
 * Copyright 2018 Bart Butenaers
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
 module.exports = function(RED) {
    var settings = RED.settings;
    var sizeof = require('object-sizeof');
    var wildstring = require('wildstring');

    function MemoryAnalyserNode(config) {
        RED.nodes.createNode(this, config);
        this.typeFilter           = config.typefilter || "";
        this.nameFilter           = config.namefilter || "";
        this.idfilter             = config.idfilter || "";
        this.tabidfilter          = config.tabidfilter || "";
        this.excludeid            = config.excludeid || "";
        this.topCount             = config.topCount || 0;
        this.sort                 = config.sort;
        this.separatemsg          = config.separatemsg;
        this.sum                  = config.sum;
        this.nodesToAnalyse       = [];
        
        var node = this;
        
        wildstring.caseSensitive = false; 
               
        RED.nodes.eachNode(function(nodeToAnalyse) {
            if (node.typeFilter.length === 0 || wildstring.match(node.typeFilter, nodeToAnalyse.type)) {
                // We only want to analyse nodes that are used in the flow (not tabsheets, ui groups, ...)
                // Seems that the only thing those nodes have in common, is that they have a 'wires' field...
                if (nodeToAnalyse.wires) {
                    if (node.nameFilter.length === 0 || wildstring.match(node.nameFilter, nodeToAnalyse.name)) {
                        if (node.idfilter.length === 0 || wildstring.match(node.idfilter, nodeToAnalyse.id)) {
                            if (node.tabidfilter.length == 0 || wildstring.match(node.tabidfilter, nodeToAnalyse.z)) {
                                if (node.excludeid.length == 0 || !wildstring.match(node.excludeid, nodeToAnalyse.id)) {
                                    node.nodesToAnalyse.push( {node:nodeToAnalyse} );
                                }
                            }
                        }
                    }
                }
            }              
        });

        this.on("input", function(msg) {
            var result = [];
            
            debugger;
            
            // Remember this node's original id and z
            var originalId = this.id;
            var originalZ = this.z;
            
            for (var i = 0; i < node.nodesToAnalyse.length; i++) {
                var nodeToAnalyse = node.nodesToAnalyse[i];
                
                var analysis = {};
                analysis.id   = nodeToAnalyse.node.id;
                analysis.tab  = nodeToAnalyse.node.z
                analysis.type = nodeToAnalyse.node.type;
                analysis.name = nodeToAnalyse.node.name;
                
                // Calculate the new size of the node
                analysis.node_size = sizeof(nodeToAnalyse.node) /*- sizeof(nodeToAnalyse.node.wires)*/;
                
                // Calculate the node size difference compared to the previous size (plus = increased / minus = decreased).
                // For the first analysis, we will pass a zero difference
                analysis.node_difference = analysis.node_size - (nodeToAnalyse.previousNodeSize || analysis.node_size);
                                
                // We can only get the context of other nodes by pretending we are that node.
                // This can easily be done by using the same node id and z in this node.
                // Since we cannot access nodeToAnalyse.node.context() here, we are going to access it via THIS node.
                this.id = analysis.id;
                this.z = analysis.z;
                
                // Calculate the new size of the node context, as the sum of the sizes of all variables on the node context memory
                analysis.context_size = 0;
                for (var j = 0; j < node.context().keys(); j++) {
                    var key = nodeToAnalyse.node.context().keys()[j];
                    analysis.context_size += sizeof(nodeToAnalyse.node.context().get(key) || {});
                }
                
                // Calculate the context size difference compared to the previous size (plus = increased / minus = decreased).
                // For the first analysis, we will pass a zero difference
                analysis.context_difference = analysis.context_size - (nodeToAnalyse.previousContextSize || analysis.context_size);

                // Calculate the total size, which contains both the node size and the context size
                analysis.total_size = analysis.node_size + analysis.context_size;
                
                // Calculate the total size difference compared to the previous size (plus = increased / minus = decreased).
                analysis.total_difference = analysis.node_difference + analysis.context_difference;

                // Remember the current sizes for the next difference calculations
                nodeToAnalyse.previousNodeSize = analysis.node_size;
                nodeToAnalyse.previousContextSize = analysis.context_size;
                
                result.push(analysis);
            }
            
            // Restore this node's original id and zIndex
            this.id = originalId;
            this.z = originalZ;
            
            if (node.analyseflowcontext) {
                // TODO node.nodesToAnalyse.push( {node: 'flow'} );
            }
            
            if (node.analyseglobalcontext) {
                // TODO node.nodesToAnalyse.push( {node: 'global'} );
            }
            
            if (node.sum === true) {
                var sum = 0;
                
                for (var j = 0; j < result.length; j++) {
                    sum += result[j].node_size;
                }
                
                result.push( {id: 'total_sum', size: sum} );
            }
            
            // Sort the list by memory sizes (numerically) descending
            result.sort(function(a, b) {
                return parseFloat(b.node_size) - parseFloat(a.node_size);
            });
            
            if (node.topCount > 0) {
                // Keep only the N highest numbers
                result.length = Math.min(node.topCount, result.length);
            }
            
            switch (node.sort) {
                case "size":
                    // Do nothing since the array is already ordered by size (see above)
                    break;
                case "name":
                    // Sort the array by node name
                    result.sort(function(a, b) {
                        if(a.name < b.name) { return -1; }
                        if(a.name > b.name) { return 1; }
                        return 0;
                    });
                    break;
                case "type":
                    // Sort the array by node type
                    result.sort(function(a, b) {
                        if(a.type < b.type) { return -1; }
                        if(a.type > b.type) { return 1; }
                        return 0;
                    });
                    break;
            }
            
            if (node.separatemsg) {
                for (var i = 0; i < result.length; i++) {
                    analysis = result[i];
                    msg.topic = analysis.id;
                    msg.payload = analysis.node_size;
                    node.send(msg);
                }
            }
            else {
                // Single message containing information for ALL nodes
                msg.payload = result;
                node.send(msg);
            }
        });
        
        this.on("end", function(msg) {
            // Remove the nodes from the array, so the garbage collection can cleanup nodes (that are deleted by the user)
            this.nodesToAnalyselist.length = 0;
        });
    }

    RED.nodes.registerType("memory-analyser", MemoryAnalyserNode);
}
