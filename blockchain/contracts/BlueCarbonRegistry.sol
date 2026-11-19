// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BlueCarbonRegistry {
    address public owner;

    struct PlotCredit {
        uint256 plotId;
        string plotName;
        uint256 totalCredits;
        uint256 issuedCredits;
        uint256 retiredCredits;
        bool isAuthorised;
    }

    struct RetirementProof {
        string batchSerial;
        string buyerName;
        uint256 amount;
        uint256 timestamp;
    }

    mapping(uint256 => PlotCredit) public plotCredits;
    mapping(string => RetirementProof) public retirements;

    event CreditsAuthorised(uint256 indexed plotId, uint256 credits);
    event CreditsRetired(uint256 indexed plotId, string batchSerial, uint256 amount, string buyer);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only registry authority can execute this");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function registerPlotCredits(uint256 _plotId, string memory _plotName, uint256 _credits) external onlyOwner {
        require(plotCredits[_plotId].plotId == 0, "Plot already registered");
        plotCredits[_plotId] = PlotCredit({
            plotId: _plotId,
            plotName: _plotName,
            totalCredits: _credits,
            issuedCredits: 0,
            retiredCredits: 0,
            isAuthorised: false
        });
    }

    function authoriseCredits(uint256 _plotId) external onlyOwner {
        PlotCredit storage plot = plotCredits[_plotId];
        require(!plot.isAuthorised, "Already authorised");
        plot.isAuthorised = true;
        plot.issuedCredits = plot.totalCredits;
        emit CreditsAuthorised(_plotId, plot.issuedCredits);
    }

    function retireCredit(uint256 _plotId, string memory _serial, string memory _buyer, uint256 _amount) external {
        PlotCredit storage plot = plotCredits[_plotId];
        require(plot.isAuthorised, "Plot not authorised yet");
        require(plot.issuedCredits - plot.retiredCredits >= _amount, "Insufficient active credits");

        plot.retiredCredits += _amount;
        retirements[_serial] = RetirementProof({
            batchSerial: _serial,
            buyerName: _buyer,
            amount: _amount,
            timestamp: block.timestamp
        });

        emit CreditsRetired(_plotId, _serial, _amount, _buyer);
    }
}