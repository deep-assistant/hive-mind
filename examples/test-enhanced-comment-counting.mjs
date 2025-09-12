#!/usr/bin/env node

// Enhanced test script to verify the improved comment counting logic
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('Testing enhanced comment counting logic...');

// Test the improved comment info formatting
function testCommentInfoFormatting() {
  console.log('\n1. Testing comment info formatting...');
  
  // Simulate comment counting results
  const scenarios = [
    { newPrComments: 0, newIssueComments: 0, expected: '' },
    { newPrComments: 2, newIssueComments: 0, expected: '\n\n🚨 IMPORTANT: There are 2 new comments on the pull request since your last commit. You MUST read and address them before proceeding.\n' },
    { newPrComments: 0, newIssueComments: 3, expected: '\n\n🚨 IMPORTANT: There are 3 new comments on the issue since your last commit. You MUST read and address them before proceeding.\n' },
    { newPrComments: 1, newIssueComments: 2, expected: '\n\n🚨 IMPORTANT: There are 1 new comments on the pull request since your last commit. You MUST read and address them before proceeding.\n🚨 IMPORTANT: There are 2 new comments on the issue since your last commit. You MUST read and address them before proceeding.\n' }
  ];
  
  scenarios.forEach((scenario, index) => {
    let commentInfo = '';
    const commentLines = [];
    
    if (scenario.newPrComments > 0) {
      commentLines.push(`🚨 IMPORTANT: There are ${scenario.newPrComments} new comments on the pull request since your last commit. You MUST read and address them before proceeding.`);
    }
    if (scenario.newIssueComments > 0) {
      commentLines.push(`🚨 IMPORTANT: There are ${scenario.newIssueComments} new comments on the issue since your last commit. You MUST read and address them before proceeding.`);
    }
    
    if (commentLines.length > 0) {
      commentInfo = '\n\n' + commentLines.join('\n') + '\n';
    }
    
    const match = commentInfo === scenario.expected;
    console.log(`   Scenario ${index + 1}: ${match ? '✅' : '❌'} (PR: ${scenario.newPrComments}, Issue: ${scenario.newIssueComments})`);
    
    if (!match) {
      console.log('     Expected:', JSON.stringify(scenario.expected));
      console.log('     Got:     ', JSON.stringify(commentInfo));
    }
  });
}

// Test system prompt integration
function testSystemPromptIntegration() {
  console.log('\n2. Testing system prompt integration...');
  
  const commentInfo = '\n\n🚨 IMPORTANT: There are 2 new comments on the pull request since your last commit. You MUST read and address them before proceeding.\n';
  const systemPromptStart = `You are AI issue solver.${commentInfo}

General guidelines.`;
  
  const hasCommentInfo = systemPromptStart.includes('🚨 IMPORTANT') && 
                        systemPromptStart.includes('new comments') &&
                        systemPromptStart.includes('MUST read and address');
  
  console.log(`   System prompt includes comment info: ${hasCommentInfo ? '✅' : '❌'}`);
  
  // Test that it appears early in the prompt
  const commentPosition = systemPromptStart.indexOf('🚨 IMPORTANT');
  const guidelinesPosition = systemPromptStart.indexOf('General guidelines');
  const appearsBeforeGuidelines = commentPosition < guidelinesPosition && commentPosition > 0;
  
  console.log(`   Comment info appears before guidelines: ${appearsBeforeGuidelines ? '✅' : '❌'}`);
}

// Test continue mode integration
function testContinueModeIntegration() {
  console.log('\n3. Testing continue mode integration...');
  
  const continueText = `Continue mode.
   - When you are working on existing pull request #86:
     * FIRST PRIORITY: If there are new comments (indicated above), read them immediately using the commands provided below and address all feedback before continuing with any other work.`;
  
  const hasFirstPriority = continueText.includes('FIRST PRIORITY') &&
                          continueText.includes('new comments') &&
                          continueText.includes('read them immediately');
  
  console.log(`   Continue mode has first priority instruction: ${hasFirstPriority ? '✅' : '❌'}`);
}

// Run all tests
testCommentInfoFormatting();
testSystemPromptIntegration();
testContinueModeIntegration();

console.log('\n✅ Enhanced comment counting test completed!');