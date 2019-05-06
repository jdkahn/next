const escomplex = require('typhonjs-escomplex');
const glob = require('glob');
const fse = require('fs-extra');
// const process = require('process');
const json2csv = require('json-2-csv');

// function complexitySynthesis(data) {
//     if (!data) {
//         return {};
//     }

//     const averages = {
//         maintainability: data.moduleAverage.maintainability,
//         cyclomatic: data.moduleAverage.methodAverage.cyclomatic,
//         bugs: data.moduleAverage.methodAverage.bugs,
//         effort: data.moduleAverage.methodAverage.effort,
//     };

//     const moduleData = data.modules.map(module => {
//         const {
//             filePath,
//             maintainability,
//             aggregate,
//             aggregateAverage,
//         } = module;

//         return {
//             filePath,
//             maintainability,
//             cyclomaticAggregate: aggregate.cyclomatic,
//             cyclomaticAggregateAverage: aggregateAverage.cyclomatic,
//             llocAggregate: aggregate.sloc.logical,
//             llocAggregateAverage: aggregateAverage.sloc.logical,
//             effort: aggregate.halstead.effort,
//             volume: aggregate.halstead.volume,
//             bugs: aggregate.halstead.bugs,
//             time: aggregate.halstead.time,
//         };
//     });

//     return {
//         averages,
//         moduleData,
//     };
// }

function calculateModuleComplexity(modules) {
    const complexity = modules.map(module => module.aggregate.cyclomatic);
    const aggregate = complexity.reduce((memo, current) => memo + current, 0);
    return {
        aggregate,
        average: modules.length ? aggregate / modules.length : 0,
    };
}

function calculateModuleHalstead(modules) {
    const halstead = modules.map(module => module.aggregate.halstead);
    const aggregateBugs = halstead.reduce(
        (memo, current) => memo + current.bugs,
        0
    );
    const aggregateTime = halstead.reduce(
        (memo, current) => memo + current.bugs,
        0
    );

    return {
        aggregateBugs,
        averageBugs: halstead.length ? aggregateBugs / halstead.length : 0,
        aggregateTime,
        averageTime: halstead.length ? aggregateTime / halstead.length : 0,
    };
}

function complexitySynthesisDir(data) {
    if (!data) {
        return {};
    }

    const complexity = calculateModuleComplexity(data.modules);
    const halstead = calculateModuleHalstead(data.modules);

    return {
        fileCount: data.modules.length,
        maintainability: data.moduleAverage.maintainability,

        aggregateModuleComplexity: complexity.aggregate,
        averageModuleComplexity: complexity.average,

        aggregateModuleBugs: halstead.aggregateBugs,
        averageModuleBugs: halstead.averageBugs,
        aggregateModuleTime: halstead.aggregateTime,
        averageModuleTime: halstead.averageTime,

        // methodAverageCyclomatic: data.moduleAverage.methodAverage.cyclomatic,
        // firstModuleAggregateCyclomatic: data.modules.length && data.modules[0].aggregate.cyclomatic,

        MethodAverageCyclomatic: data.moduleAverage.methodAverage.cyclomatic,
        MethodAverageBugs: data.moduleAverage.methodAverage.halstead.bugs,
        MethodAverageEffort: data.moduleAverage.methodAverage.halstead.effort,
        MethodAverageLloc: data.moduleAverage.methodAverage.sloc.logical,
    };
}

function complexityForDir(dir) {
    const files = glob.sync(`${dir}**/!(style).@(js|jsx)`);
    const source = files.map(f => ({
        filePath: f,
        srcPath: f,
        code: fse.readFileSync(f, 'utf8'),
    }));

    const result = escomplex.analyzeProject(source, {});
    return {
        dir,
        ...complexitySynthesisDir(result),
    };
}

function complexity() {
    const dirs = glob.sync('./src/*/');

    const results = dirs.map(dir => complexityForDir(dir));

    json2csv.json2csv(results, (err, csv) => {
        if (err) {
            // eslint-disable-next-line no-console
            console.error(err);
            return;
        }
        fse.outputFileSync('./complexity-reports/grouped-by-dir.csv', csv);
    });
}

complexity();

// const path = process.argv[2];
// if (!path) return;

// const source = files.map(f => ({
//     filePath: f,
//     srcPath: f,
//     code: fse.readFileSync(f, 'utf8')
// }))

// const result = escomplex.analyzeProject(source, {});
// fse.writeJSONSync('./complexity-reports/raw.json', result, { spaces: '\t'});
// const filteredResults = complexitySynthesis(result);
// fse.writeJSONSync('./complexity-reports/filtered.json', filteredResults, { spaces: '\t'});
